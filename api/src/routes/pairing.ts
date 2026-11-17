import { Hono } from "hono";
import { z } from "zod";
import { newId } from "@ideatrail/crypto/ids";
import { toB64u, toHex } from "@ideatrail/crypto/bytes";
import type { AppEnv, Bindings } from "../env";
import { ApiError } from "../http/errors";
import { browserWrite } from "../http/browser";
import { ipLimit, type Limiter } from "../http/rate-limit";
import { readJson, zB64u, zHex, zId, zSealed } from "../http/validate";
import { requireConfirmed } from "../auth/session";
import { requirePairingEngine } from "../auth/engine-sig";
import { CURSOR_SQL, guard, writeWithCursor } from "../db/change";
import { inSeconds, nowIso, toBytes } from "../db/values";

export const PAIRING_SECONDS = 10 * 60;
const KIND_PAIRING_PAYLOAD = 8;
const RELOCK_ENGINE_LIST = 0x88;

const zStart = z.object({ engine_id: zId, sign_pubkey: zB64u(32), kem_pubkey: zB64u(32) });
const zDeliver = z.object({
  payload: zSealed(KIND_PAIRING_PAYLOAD),
  mac: zHex(32),
  engine_list: zSealed(RELOCK_ENGINE_LIST),
  engine_list_version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});

const notFound = () => new ApiError(404, "pairing_not_found", "Pairing session not found");
const listConflict = () => new ApiError(409, "engine_list_conflict", "Engine list changed on another device; reload and retry");

interface SessionRow { engine_id: string; sign_pubkey: unknown; kem_pubkey: unknown; user_id: string | null; payload: unknown; payload_mac: string | null; used_at: string | null; expires_at: string }

const loadSession = (db: D1Database, id: string) =>
  db.prepare("SELECT engine_id, sign_pubkey, kem_pubkey, user_id, payload, payload_mac, used_at, expires_at FROM pairing_sessions WHERE session_id = ?")
    .bind(id).first<SessionRow>();

export function pairingRoutes(getLimiter: (env: Bindings) => Limiter) {
  const r = new Hono<AppEnv>();

  /** Engine starts pairing (spec §9-1). Unauthenticated, IP-limited; an engine_id is never reused. */
  r.post("/", ipLimit("pairing_start", getLimiter), async (c) => {
    const body = await readJson(c, zStart);
    const db = c.env.DB;
    const known = await db.prepare("SELECT 1 FROM engines WHERE engine_id = ?1 UNION ALL SELECT 1 FROM pairing_sessions WHERE engine_id = ?1").bind(body.engine_id).first();
    if (known) throw new ApiError(409, "engine_exists", "This engine id is already used; pair with a new one");
    const sessionId = newId();
    const expiresAt = inSeconds(PAIRING_SECONDS);
    try {
      await db.prepare("INSERT INTO pairing_sessions (session_id, engine_id, sign_pubkey, kem_pubkey, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(sessionId, body.engine_id, body.sign_pubkey, body.kem_pubkey, nowIso(), expiresAt).run();
    } catch (err) {
      if (err instanceof Error && /UNIQUE/.test(err.message)) throw new ApiError(409, "engine_exists", "This engine id is already used; pair with a new one");
      throw err;
    }
    return c.json({ session_id: sessionId, expires_at: expiresAt }, 201);
  });

  /** Signup page fetches the engine's public keys to compare with the link's # fingerprints (spec §9-3). */
  r.get("/:id", ipLimit("pairing_get", getLimiter), async (c) => {
    const s = await loadSession(c.env.DB, c.req.param("id"));
    if (!s) throw notFound();
    const delivered = s.used_at !== null;
    if (!delivered && s.expires_at <= nowIso()) throw new ApiError(410, "pairing_expired", "Pairing expired; start again from Claude Code");
    return c.json({ engine_id: s.engine_id, sign_pubkey: toB64u(toBytes(s.sign_pubkey)), kem_pubkey: toB64u(toBytes(s.kem_pubkey)), expires_at: s.expires_at, delivered });
  });

  /**
   * Browser → engine handoff right after signup (spec §9-4). One atomic batch: the engine list moves
   * from version N to N+1 (server checks N+1 itself), the session is used once, and the engines and
   * connectors rows are created with the session's keys and request sequence.
   */
  r.post("/:id/deliver", browserWrite, requireConfirmed, async (c) => {
    const body = await readJson(c, zDeliver);
    const id = c.req.param("id");
    const userId = c.get("userId")!;
    const db = c.env.DB;
    const s = await loadSession(db, id);
    if (!s) throw notFound();
    if (s.user_id !== userId) throw new ApiError(403, "not_your_pairing", "This pairing belongs to another signup");
    if (s.used_at) throw new ApiError(409, "pairing_used", "Already delivered");
    if (s.expires_at <= nowIso()) throw new ApiError(410, "pairing_expired", "Pairing expired; start again from Claude Code");
    const prev = await db.prepare("SELECT engine_list_version FROM users WHERE user_id = ?").bind(userId).first<number>("engine_list_version");
    if (prev === null || body.engine_list_version !== prev + 1) throw listConflict();
    const now = nowIso();
    await writeWithCursor(db, userId, [
      db.prepare("UPDATE users SET engine_list = ?, engine_list_version = ? WHERE user_id = ? AND engine_list_version = ?")
        .bind(body.engine_list, body.engine_list_version, userId, prev),
      guard(db),
      db.prepare("UPDATE pairing_sessions SET payload = ?, payload_mac = ?, used_at = ? WHERE session_id = ? AND user_id = ? AND used_at IS NULL AND expires_at > ?")
        .bind(body.payload, toHex(body.mac), now, id, userId, now),
      guard(db),
      db.prepare(`INSERT INTO engines (engine_id, user_id, sign_pubkey, kem_pubkey, last_req_seq, created_at, change_seq)
                  SELECT engine_id, ?, sign_pubkey, kem_pubkey, last_req_seq, ?, ${CURSOR_SQL} FROM pairing_sessions WHERE session_id = ?`)
        .bind(userId, now, userId, id),
      db.prepare("INSERT INTO connectors (connector_id, user_id, kind, created_at) SELECT engine_id, ?, 'local', ? FROM pairing_sessions WHERE session_id = ?")
        .bind(userId, now, id),
    ], listConflict());
    return c.json({ engine_id: s.engine_id, engine_list_version: body.engine_list_version });
  });

  /** Engine picks up the sealed handoff, signed with the pairing session's key (spec §9-5). */
  r.get("/:id/blob", requirePairingEngine, async (c) => {
    const s = await loadSession(c.env.DB, c.req.param("id"));
    if (!s || !s.payload || !s.user_id || !s.payload_mac) throw new ApiError(404, "not_ready", "Nothing delivered yet");
    return c.json({ user_id: s.user_id, payload: toB64u(toBytes(s.payload)), mac: s.payload_mac });
  });

  return r;
}
