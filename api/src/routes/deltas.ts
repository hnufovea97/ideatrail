import { Hono } from "hono";
import { z } from "zod";
import { toB64u } from "@ideatrail/crypto/bytes";
import type { AppEnv } from "../env";
import { ApiError } from "../http/errors";
import { readJson, zB64u, zId, zSealedMax, zSeq, zTime } from "../http/validate";
import { requireEngine } from "../auth/engine-sig";
import { CURSOR_SQL, guard, writeWithCursor } from "../db/change";
import { checkEngineQuota, countEngineWrite } from "../db/quota";
import { idConflict, isConstraintError, requireEngineAccount } from "./engine-common";

const KIND_DELTA = 4;
export const MAX_OPEN_DELTAS = 500;

const zDelta = z.object({
  delta_id: zId,
  root_id: zId,
  sealed_delta: zSealedMax(KIND_DELTA, 16 * 1024),
  log_seq: zSeq,
  created_at: zTime,
  engine_sig: zB64u(64),
});
type DeltaBody = z.infer<typeof zDelta>;

async function duplicate(db: D1Database, b: DeltaBody, userId: string, engineId: string) {
  const row = await db.prepare("SELECT user_id, engine_id, CAST(seq AS TEXT) AS seq FROM meta_deltas WHERE delta_id = ?")
    .bind(b.delta_id).first<{ user_id: string; engine_id: string; seq: string }>();
  if (!row) return false;
  if (row.user_id === userId && row.engine_id === engineId && row.seq === b.log_seq) return true;
  throw idConflict();
}

export function deltaRoutes() {
  const r = new Hono<AppEnv>();

  /** A metadata delta for an existing root of this account (deltas never create roots). */
  r.post("/", requireEngine, requireEngineAccount, async (c) => {
    const b = await readJson(c, zDelta);
    const db = c.env.DB;
    const userId = c.get("userId")!;
    const engineId = c.get("engineId")!;
    if (await duplicate(db, b, userId, engineId)) return c.json({ delta_id: b.delta_id, duplicate: true });
    const owner = await db.prepare("SELECT user_id FROM roots WHERE root_id = ? AND deleted_at IS NULL").bind(b.root_id).first<string>("user_id");
    if (owner !== userId) throw new ApiError(404, "root_not_found", "No such root");
    const open = await db.prepare("SELECT COUNT(*) AS n FROM meta_deltas WHERE root_id = ? AND merged_at IS NULL").bind(b.root_id).first<number>("n");
    if ((open ?? 0) >= MAX_OPEN_DELTAS) throw new ApiError(429, "too_many_deltas", "Open the dashboard to merge pending changes");
    await checkEngineQuota(db, engineId, userId);
    try {
      await writeWithCursor(db, userId, [
        ...countEngineWrite(db, engineId),
        db.prepare(`INSERT INTO meta_deltas (delta_id, user_id, root_id, engine_id, seq, sealed_delta, engine_sig, created_at, change_seq)
                    SELECT ?, ?, ?, ?, CAST(? AS INTEGER), ?, ?, ?, ${CURSOR_SQL}
                    WHERE (SELECT COUNT(*) FROM meta_deltas WHERE root_id = ? AND merged_at IS NULL) < ?
                      AND EXISTS (SELECT 1 FROM roots WHERE root_id = ? AND user_id = ? AND deleted_at IS NULL)`)
          .bind(b.delta_id, userId, b.root_id, engineId, b.log_seq, b.sealed_delta, toB64u(b.engine_sig), b.created_at, userId,
            b.root_id, MAX_OPEN_DELTAS, b.root_id, userId),
        guard(db),
      ]);
    } catch (err) {
      if (!isConstraintError(err)) throw err;
      if (await duplicate(db, b, userId, engineId)) return c.json({ delta_id: b.delta_id, duplicate: true });
      throw idConflict();
    }
    return c.json({ delta_id: b.delta_id }, 201);
  });

  return r;
}
