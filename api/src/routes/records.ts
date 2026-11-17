import { Hono } from "hono";
import { z } from "zod";
import { fromHex, toB64u } from "@ideatrail/crypto/bytes";
import type { AppEnv } from "../env";
import { ApiError } from "../http/errors";
import { readJson, zB64u, zB64uMax, zHexText, zId, zSealedMax, zSeq, zTime } from "../http/validate";
import { requireEngine } from "../auth/engine-sig";
import { CURSOR_SQL, guard, writeWithCursor } from "../db/change";
import { checkEngineQuota, countEngineWrite } from "../db/quota";
import { inSeconds, nowIso } from "../db/values";
import { calendarHost, checkPendingReceipt } from "../ots/calendars";
import { OtsError } from "../ots/tree";
import { idConflict, isConstraintError, requireEngineAccount } from "./engine-common";

const KIND_RECORD_META = 1;
export const MAX_PENDING_ANCHORS = 500;
export const FIRST_CHECK_SECONDS = 30 * 60;

const zParents = z.array(zId).max(16).refine((ids) => ids.every((id, i) => i === 0 || ids[i - 1] < id), "parent_ids must be sorted and unique");

const zRecord = z.object({
  record_id: zId,
  root_id: zId,
  parent_ids: zParents,
  commitment: zHexText(32),
  manifest: z.boolean(),
  recorded_at: zTime,
  log_seq: zSeq,
  list_meta: zSealedMax(KIND_RECORD_META, 8192),
  body_hash: zHexText(32),
  nonce_hash: zHexText(32),
  engine_sig: zB64u(64),
  ots: z.array(z.object({ calendar: z.string().max(200), pending: zB64uMax(8192) })).min(1).max(3),
  import: z.boolean().optional(),
});
type RecordBody = z.infer<typeof zRecord>;

interface Existing { user_id: string; engine_id: string; engine_seq: number; commitment: string }

/** Retried upload of the same record → 200 duplicate; any other clash → the same 409 (no oracle). */
async function duplicateOrConflict(db: D1Database, b: RecordBody, userId: string, engineId: string) {
  const row = await db.prepare("SELECT user_id, engine_id, CAST(engine_seq AS TEXT) AS engine_seq, commitment FROM records WHERE record_id = ?")
    .bind(b.record_id).first<Existing>();
  if (row && row.user_id === userId && row.engine_id === engineId && String(row.engine_seq) === b.log_seq && row.commitment === b.commitment) {
    return { duplicate: true as const };
  }
  if (row) throw idConflict();
  return null;
}

function checkReceipts(b: RecordBody) {
  const commitment = fromHex(b.commitment);
  for (const r of b.ots) {
    if (calendarHost(r.calendar) === null) throw new ApiError(400, "invalid_receipt", "Calendar not allowed");
    try {
      checkPendingReceipt(r.pending, commitment);
    } catch (err) {
      if (err instanceof OtsError) throw new ApiError(400, "invalid_receipt", "Receipt rejected");
      throw err;
    }
  }
}

/** Import allowance: one per record during signup import (separate from the hourly cap). */
async function importStatements(db: D1Database, userId: string) {
  const row = await db.prepare("SELECT remaining FROM import_allowances WHERE user_id = ? AND expires_at > ?").bind(userId, nowIso()).first<number>("remaining");
  if (!row) throw new ApiError(429, "import_allowance_used", "Import allowance used up");
  return [
    db.prepare("UPDATE import_allowances SET remaining = remaining - 1 WHERE user_id = ? AND remaining > 0 AND expires_at > ?").bind(userId, nowIso()),
    guard(db),
  ];
}

export function recordRoutes() {
  const r = new Hono<AppEnv>();

  /** One record (spec §8 record + §12 bundle fields). Server stores; the browser verifies engine_sig. */
  r.post("/", requireEngine, requireEngineAccount, async (c) => {
    const b = await readJson(c, zRecord);
    const db = c.env.DB;
    const userId = c.get("userId")!;
    const engineId = c.get("engineId")!;
    checkReceipts(b);

    const dup = await duplicateOrConflict(db, b, userId, engineId);
    if (dup) return c.json({ record_id: b.record_id, ...dup });
    const owner = await db.prepare("SELECT user_id FROM roots WHERE root_id = ?").bind(b.root_id).first<string>("user_id");
    if (owner && owner !== userId) throw idConflict();
    const pending = await db.prepare("SELECT COUNT(*) AS n FROM anchors WHERE user_id = ? AND status = 'pending'").bind(userId).first<number>("n");
    if ((pending ?? 0) >= MAX_PENDING_ANCHORS) throw new ApiError(429, "too_many_pending", "Too many receipts still waiting for Bitcoin");

    const quota = b.import ? await importStatements(db, userId) : (await checkEngineQuota(db, engineId, userId), countEngineWrite(db, engineId));
    const now = nowIso();
    const calendars = JSON.stringify(b.ots.map((o) => ({ calendar: o.calendar, pending: toB64u(o.pending), attempts: 0 })));
    try {
      await writeWithCursor(db, userId, [
        ...quota,
        db.prepare(`INSERT OR IGNORE INTO roots (root_id, user_id, created_at, change_seq) VALUES (?, ?, ?, ${CURSOR_SQL})`).bind(b.root_id, userId, now, userId),
        db.prepare("UPDATE roots SET change_seq = change_seq WHERE root_id = ? AND user_id = ? AND deleted_at IS NULL").bind(b.root_id, userId),
        guard(db),
        db.prepare(`INSERT INTO records (record_id, user_id, root_id, parent_ids, commitment, manifest, recorded_at, engine_id, engine_seq, engine_sig,
                      list_meta, body_hash, nonce_hash, change_seq)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS INTEGER), ?, ?, ?, ?, ${CURSOR_SQL})`)
          .bind(b.record_id, userId, b.root_id, b.parent_ids.length ? b.parent_ids.join(",") : "-", b.commitment, b.manifest ? 1 : 0, b.recorded_at,
            engineId, b.log_seq, toB64u(b.engine_sig), b.list_meta, b.body_hash, b.nonce_hash, userId),
        db.prepare(`INSERT INTO anchors (record_id, user_id, calendars, next_check_at, change_seq) VALUES (?, ?, ?, ?, ${CURSOR_SQL})`)
          .bind(b.record_id, userId, calendars, inSeconds(FIRST_CHECK_SECONDS), userId),
        db.prepare("UPDATE engines SET last_log_seq = MAX(last_log_seq, CAST(? AS INTEGER)) WHERE engine_id = ?").bind(b.log_seq, engineId),
      ]);
    } catch (err) {
      if (!isConstraintError(err)) throw err;
      const again = await duplicateOrConflict(db, b, userId, engineId);
      if (again) return c.json({ record_id: b.record_id, ...again });
      throw idConflict(); // e.g. same log_seq used for another record
    }
    return c.json({ record_id: b.record_id }, 201);
  });

  return r;
}
