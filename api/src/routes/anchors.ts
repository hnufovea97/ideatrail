import { Hono } from "hono";
import { z } from "zod";
import { newId } from "@ideatrail/crypto/ids";
import { toB64u } from "@ideatrail/crypto/bytes";
import type { AppEnv } from "../env";
import { ApiError } from "../http/errors";
import { readJson, zB64u, zId, zSealedMax, zTime } from "../http/validate";
import { requireEngine } from "../auth/engine-sig";
import { engineOrSession, isEngine } from "../auth/either";
import { CURSOR_SQL, guard, runBatch, writeWithCursor } from "../db/change";
import { checkEngineQuota, countEngineWrite } from "../db/quota";
import { inSeconds, isoAt, nowIso } from "../db/values";
import { requireEngineAccount } from "./engine-common";

const PAGE = 200;
const KIND_STORAGE_TOKEN = 6;
export const KEEP_REPO_HEADS = 50;
export const IMPORT_ALLOWANCE = 200;
export const IMPORT_DAYS = 7;

const zCursor = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export function anchorRoutes() {
  const r = new Hono<AppEnv>();

  /** Confirmed receipts after `since` (an account change_seq), oldest first. */
  r.get("/confirmed", engineOrSession, async (c) => {
    const since = zCursor.safeParse(c.req.query("since") ?? "0");
    if (!since.success) throw new ApiError(400, "invalid_input", "since");
    const { results } = await c.env.DB.prepare(
      `SELECT record_id, complete_receipt, block_height, confirmed_at, change_seq FROM anchors
        WHERE user_id = ? AND status = 'confirmed' AND change_seq > ? ORDER BY change_seq LIMIT ?`,
    ).bind(c.get("userId"), since.data, PAGE + 1).all<{ change_seq: number }>();
    const page = results.slice(0, PAGE);
    return c.json({ anchors: page, next_cursor: results.length > PAGE ? page[page.length - 1].change_seq : null });
  });

  /** Mark a receipt as copied locally (engine only) or into the GitHub repo. */
  r.post("/:record_id/synced", engineOrSession, async (c) => {
    const { target } = await readJson(c, z.object({ target: z.enum(["local", "repo"]) }));
    if (target === "local" && !isEngine(c)) throw new ApiError(403, "engine_only", "Only the engine keeps local copies");
    const recordId = zId.safeParse(c.req.param("record_id"));
    if (!recordId.success) throw new ApiError(404, "anchor_not_found", "No such receipt");
    const column = target === "local" ? "local_synced_at" : "synced_to_repo_at";
    const userId = c.get("userId")!;
    await writeWithCursor(c.env.DB, userId, [
      c.env.DB.prepare(`UPDATE anchors SET ${column} = ?, change_seq = ${CURSOR_SQL} WHERE record_id = ? AND user_id = ?`).bind(nowIso(), userId, recordId.data, userId),
      guard(c.env.DB),
    ], new ApiError(404, "anchor_not_found", "No such receipt"));
    return c.json({ synced: target });
  });

  return r;
}

const zStorageLink = z.object({
  enc_token: zSealedMax(KIND_STORAGE_TOKEN, 4096),
  engine_sig: zB64u(64),
  unix_ts: z.number().int().min(0).max(2 ** 40),
});

/** PUT /v1/storage-link — the engine's GitHub token sealed to the account key, one row per engine. */
export function storageLinkRoutes() {
  const r = new Hono<AppEnv>();
  r.put("/", requireEngine, requireEngineAccount, async (c) => {
    const b = await readJson(c, zStorageLink);
    const db = c.env.DB;
    const userId = c.get("userId")!;
    const engineId = c.get("engineId")!;
    await checkEngineQuota(db, engineId, userId);
    // created_at carries unix_ts exactly (the browser needs it to check the storagelink signature, spec §8).
    await writeWithCursor(db, userId, [
      ...countEngineWrite(db, engineId),
      db.prepare(`INSERT INTO storage_links (link_id, user_id, engine_id, enc_token, engine_sig, created_at, change_seq)
                  VALUES (?, ?, ?, ?, ?, ?, ${CURSOR_SQL})
                  ON CONFLICT(engine_id) DO UPDATE SET enc_token = excluded.enc_token, engine_sig = excluded.engine_sig,
                    created_at = excluded.created_at, revoked_at = NULL, change_seq = excluded.change_seq
                  WHERE storage_links.user_id = excluded.user_id`)
        .bind(newId(), userId, engineId, b.enc_token, toB64u(b.engine_sig), isoAt(b.unix_ts * 1000), userId),
      guard(db),
    ]);
    return c.json({ stored: true });
  });
  return r;
}

const zRepoHead = z.object({
  commit_sha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
  signature: z.string().min(1).max(200),
  reported_at: zTime,
});

/** POST /v1/repo-heads — last seen commit (engine-signed or browser HMAC); keeps the newest 50 per account. */
export function repoHeadRoutes() {
  const r = new Hono<AppEnv>();
  r.post("/", engineOrSession, async (c) => {
    const b = await readJson(c, zRepoHead);
    const db = c.env.DB;
    const userId = c.get("userId")!;
    const engineId = c.get("engineId");
    if (engineId) await checkEngineQuota(db, engineId, userId);
    await runBatch(db, [
      ...(engineId ? countEngineWrite(db, engineId) : []),
      db.prepare("INSERT INTO repo_heads (user_id, reporter, commit_sha, signature, reported_at) VALUES (?, ?, ?, ?, ?)")
        .bind(userId, engineId ?? "browser", b.commit_sha, b.signature, b.reported_at),
      db.prepare("DELETE FROM repo_heads WHERE user_id = ?1 AND id NOT IN (SELECT id FROM repo_heads WHERE user_id = ?1 ORDER BY id DESC LIMIT ?2)")
        .bind(userId, KEEP_REPO_HEADS),
    ]);
    return c.json({ stored: true }, 201);
  });
  return r;
}

/** GET /v1/import-allowance — created on first ask: 200 records over 7 days for the signup import. */
export function importAllowanceRoutes() {
  const r = new Hono<AppEnv>();
  r.get("/", requireEngine, requireEngineAccount, async (c) => {
    const db = c.env.DB;
    const userId = c.get("userId")!;
    await db.prepare("INSERT OR IGNORE INTO import_allowances (user_id, remaining, expires_at) VALUES (?, ?, ?)")
      .bind(userId, IMPORT_ALLOWANCE, inSeconds(IMPORT_DAYS * 86400)).run();
    const row = await db.prepare("SELECT remaining, expires_at FROM import_allowances WHERE user_id = ?").bind(userId).first<{ remaining: number; expires_at: string }>();
    return c.json(row);
  });
  return r;
}
