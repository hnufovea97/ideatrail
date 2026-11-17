import { Hono } from "hono";
import { z } from "zod";
import { toB64u } from "@ideatrail/crypto/bytes";
import type { AppEnv } from "../env";
import { ApiError } from "../http/errors";
import { requireConfirmed } from "../auth/session";
import { toBytes } from "../db/values";

export const SYNC_LIMIT = 100; // CPU: a full page of 16KB blobs must stay inside the 10ms budget (measure at deploy)

/** Each synced table: response key, table, columns (BLOBs listed separately so they become base64url). */
const TABLES = [
  { key: "roots", table: "roots", cols: "root_id, visibility, public_label, meta_version, list_meta, crypto_version, created_at, deleted_at", blobs: ["list_meta"] },
  { key: "records", table: "records", cols: "record_id, root_id, parent_ids, commitment, hash_alg, manifest, recorded_at, engine_id, CAST(engine_seq AS TEXT) AS log_seq, engine_sig, list_meta, body_hash, nonce_hash, crypto_version, deleted_at", blobs: ["list_meta"] },
  { key: "deltas", table: "meta_deltas", cols: "delta_id, root_id, engine_id, CAST(seq AS TEXT) AS log_seq, sealed_delta, engine_sig, created_at, merged_at", blobs: ["sealed_delta"] },
  { key: "anchors", table: "anchors", cols: "record_id, status, calendars, complete_receipt, block_height, block_time, confirmed_at, local_synced_at, synced_to_repo_at", blobs: [] },
  { key: "engines", table: "engines", cols: "engine_id, sign_pubkey, kem_pubkey, paused, pause_reason, created_at, revoked_at", blobs: ["sign_pubkey", "kem_pubkey"] },
  { key: "storage_links", table: "storage_links", cols: "link_id, engine_id, provider, enc_token, engine_sig, created_at, revoked_at", blobs: ["enc_token"] },
  { key: "approvals", table: "pending_approvals", cols: "approval_id, engine_id, kind, status, summary, CAST(engine_seq AS TEXT) AS appr_seq, engine_sig, created_at, decided_at, expires_at", blobs: ["summary"] },
] as const;


const zQuery = z.object({
  cursor: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  limit: z.coerce.number().int().min(1).max(SYNC_LIMIT).default(SYNC_LIMIT),
});

type Row = Record<string, unknown> & { change_seq: number };

/**
 * GET /v1/sync — rows changed after `cursor`. A page ends at a change_seq boundary and never splits
 * rows that share one change_seq (one write). `next_cursor` is null when nothing more is waiting.
 */
export function syncRoutes() {
  const r = new Hono<AppEnv>();
  r.get("/", requireConfirmed, async (c) => {
    const q = zQuery.safeParse({ cursor: c.req.query("cursor") ?? undefined, limit: c.req.query("limit") ?? undefined });
    if (!q.success) throw new ApiError(400, "invalid_input", "cursor/limit");
    const { cursor, limit } = q.data;
    const db = c.env.DB;
    const userId = c.get("userId")!;

    // 1) Boundary: the limit-th smallest change_seq over all tables (D1 caps compound SELECTs, so
    //    each table gives its first `limit` seqs and we merge here).
    const heads = await db.batch(TABLES.map((t) =>
      db.prepare(`SELECT change_seq FROM ${t.table} WHERE user_id = ? AND change_seq > ? ORDER BY change_seq LIMIT ?`).bind(userId, cursor, limit)));
    const seqs = heads.flatMap((h) => (h.results as { change_seq: number }[]).map((r) => r.change_seq)).sort((a, b) => a - b);
    const upper = seqs.length >= limit ? seqs[limit - 1] : Number.MAX_SAFE_INTEGER;

    // 2) Every row up to the boundary (a write's rows share one seq, so none is split), plus "is there more?".
    const results = await db.batch([
      ...TABLES.map((t) => db.prepare(`SELECT ${t.cols}, change_seq FROM ${t.table} WHERE user_id = ? AND change_seq > ? AND change_seq <= ? ORDER BY change_seq`)
        .bind(userId, cursor, upper)),
      ...TABLES.map((t) => db.prepare(`SELECT 1 AS more FROM ${t.table} WHERE user_id = ? AND change_seq > ? LIMIT 1`).bind(userId, upper)),
    ]);
    const changes: Record<string, Row[]> = {};
    let last = cursor;
    TABLES.forEach((t, i) => {
      changes[t.key] = (results[i].results as Row[]).map((row) => {
        last = Math.max(last, row.change_seq);
        const out: Row = { ...row };
        for (const b of t.blobs) out[b] = row[b] === null ? null : toB64u(toBytes(row[b]));
        return out;
      });
    });
    const more = results.slice(TABLES.length).some((r) => r.results.length > 0);
    return c.json({ changes, cursor: last, next_cursor: more ? last : null });
  });
  return r;
}
