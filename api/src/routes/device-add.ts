import { Hono } from "hono";
import { z } from "zod";
import { newId } from "@ideatrail/crypto/ids";
import { toB64u, toHex } from "@ideatrail/crypto/bytes";
import type { AppEnv, Bindings } from "../env";
import { ApiError } from "../http/errors";
import { browserWrite } from "../http/browser";
import { ipLimit, type Limiter } from "../http/rate-limit";
import { readJson, zB64u, zHex, zSealed } from "../http/validate";
import { requireConfirmed } from "../auth/session";
import { randomToken, sameText, sha256Hex } from "../auth/secrets";
import { inSeconds, nowIso, toBytes } from "../db/values";

export const DEVICE_ADD_SECONDS = 2 * 60;
const KIND_DEVICE_ADD_MASTER = 9;

const zJoin = z.object({ t_pub: zB64u(32), mac: zHex(32) });
const zKey = z.object({ sealed_mk: zSealed(KIND_DEVICE_ADD_MASTER), mac: zHex(32) });

interface Row { user_id: string; t_pubkey: unknown; join_mac: string | null; join_secret_hash: string | null; sealed_mk: unknown; key_mac: string | null; used_at: string | null; expires_at: string }
const load = (db: D1Database, id: string) =>
  db.prepare("SELECT user_id, t_pubkey, join_mac, join_secret_hash, sealed_mk, key_mac, used_at, expires_at FROM device_add_sessions WHERE session_id = ?").bind(id).first<Row>();
const notFound = () => new ApiError(404, "device_add_not_found", "Device link not found");
const expired = () => new ApiError(410, "device_add_expired", "Device link expired; show a new QR code");

/** The new device proves it is the one that joined: the secret /join returned, compared by hash. */
export async function checkJoinSecret(row: Pick<Row, "join_secret_hash">, secret: string | undefined) {
  if (!secret || !row.join_secret_hash || !sameText(await sha256Hex(secret), row.join_secret_hash)) throw new ApiError(403, "join_secret_mismatch", "This device did not join the link");
}

/** Device add (spec §10): PC session → new device joins → PC uploads sealed MK → new device registers. */
export function deviceAddRoutes(getLimiter: (env: Bindings) => Limiter) {
  const r = new Hono<AppEnv>();

  r.post("/", browserWrite, requireConfirmed, async (c) => {
    const id = newId();
    const expiresAt = inSeconds(DEVICE_ADD_SECONDS);
    await c.env.DB.prepare("INSERT INTO device_add_sessions (session_id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind(id, c.get("userId"), nowIso(), expiresAt).run();
    return c.json({ session_id: id, expires_at: expiresAt }, 201);
  });

  /** New device joins once within 2 minutes and receives a one-time secret for the later steps. */
  r.post("/:id/join", browserWrite, ipLimit("device_add_join", getLimiter), async (c) => {
    const body = await readJson(c, zJoin);
    const id = c.req.param("id");
    const secret = randomToken();
    const now = nowIso();
    const upd = await c.env.DB.prepare(
      "UPDATE device_add_sessions SET t_pubkey = ?, join_mac = ?, join_secret_hash = ? WHERE session_id = ? AND t_pubkey IS NULL AND expires_at > ?",
    ).bind(body.t_pub, toHex(body.mac), await sha256Hex(secret), id, now).run();
    if (upd.meta.changes !== 1) {
      const row = await load(c.env.DB, id);
      if (!row) throw notFound();
      if (row.expires_at <= now) throw expired();
      throw new ApiError(409, "already_joined", "Another device already joined this link");
    }
    return c.json({ join_secret: secret });
  });

  /** PC reads what the new device sent, to check the join MAC before sealing MK to it. */
  r.get("/:id", requireConfirmed, async (c) => {
    const row = await load(c.env.DB, c.req.param("id"));
    if (!row || row.user_id !== c.get("userId")) throw notFound();
    return c.json({
      joined: row.t_pubkey !== null,
      t_pub: row.t_pubkey === null ? null : toB64u(toBytes(row.t_pubkey)),
      join_mac: row.join_mac,
      key_uploaded: row.sealed_mk !== null,
      used: row.used_at !== null,
      expires_at: row.expires_at,
    });
  });

  /** PC uploads MK sealed to the new device's temporary key (kind 9), once. */
  r.post("/:id/key", browserWrite, requireConfirmed, async (c) => {
    const body = await readJson(c, zKey);
    const id = c.req.param("id");
    const row = await load(c.env.DB, id);
    if (!row || row.user_id !== c.get("userId")) throw new ApiError(403, "not_your_device_add", "This link belongs to another account");
    if (row.t_pubkey === null) throw new ApiError(409, "not_joined", "The new device has not joined yet");
    if (row.expires_at <= nowIso()) throw expired();
    const upd = await c.env.DB.prepare("UPDATE device_add_sessions SET sealed_mk = ?, key_mac = ? WHERE session_id = ? AND user_id = ? AND sealed_mk IS NULL")
      .bind(body.sealed_mk, toHex(body.mac), id, c.get("userId")).run();
    if (upd.meta.changes !== 1) throw new ApiError(409, "key_already_uploaded", "Key already sent");
    return c.json({ uploaded: true });
  });

  /** New device fetches the sealed MK, proving it is the joiner via the X-IT-Join-Secret header. */
  r.get("/:id/key", ipLimit("device_add_key", getLimiter), async (c) => {
    const row = await load(c.env.DB, c.req.param("id"));
    if (!row) throw notFound();
    await checkJoinSecret(row, c.req.header("x-it-join-secret"));
    if (row.expires_at <= nowIso()) throw expired();
    if (row.sealed_mk === null || !row.key_mac) throw new ApiError(404, "not_ready", "Waiting for the other device");
    if (row.used_at) throw new ApiError(409, "device_add_used", "This link was already used");
    return c.json({ user_id: row.user_id, sealed_mk: toB64u(toBytes(row.sealed_mk)), mac: row.key_mac });
  });

  return r;
}
