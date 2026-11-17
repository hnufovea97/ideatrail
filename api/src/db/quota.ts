import { ApiError } from "../http/errors";
import { CURSOR_SQL, guard, writeWithCursor } from "./change";
import { nowIso } from "./values";

/** Per-engine write caps shared by records, deltas, approvals and storage links (abuse + D1 write budget). */
export const HOURLY_CAP = 120;
export const DAILY_CAP = 1000;

interface EngineQuotaRow { paused: number; hourly_count: number; hour_bucket: string | null; day_count: number; day_bucket: string | null }

const buckets = () => {
  const now = nowIso();
  return { hour: now.slice(0, 13), day: now.slice(0, 10) };
};

export const engineSlowDown = () => new ApiError(423, "engine_paused", "This engine is paused; resume it from the dashboard");

/**
 * Pre-check (gives the right status code): a paused engine, or one at its cap, is refused with 423.
 * Reaching the cap pauses the engine in its own write so the dashboard sees it.
 */
export async function checkEngineQuota(db: D1Database, engineId: string, userId: string): Promise<void> {
  const row = await db.prepare("SELECT paused, hourly_count, hour_bucket, day_count, day_bucket FROM engines WHERE engine_id = ?")
    .bind(engineId).first<EngineQuotaRow>();
  if (!row || row.paused) throw engineSlowDown();
  const { hour, day } = buckets();
  const hourCount = row.hour_bucket === hour ? row.hourly_count : 0;
  const dayCount = row.day_bucket === day ? row.day_count : 0;
  if (hourCount < HOURLY_CAP && dayCount < DAILY_CAP) return;
  const reason = hourCount >= HOURLY_CAP ? "hourly_cap" : "daily_cap";
  await writeWithCursor(db, userId, [
    db.prepare(`UPDATE engines SET paused = 1, pause_reason = ?, change_seq = ${CURSOR_SQL} WHERE engine_id = ?`).bind(reason, userId, engineId),
  ]);
  throw engineSlowDown();
}

/**
 * In-batch counter bump; only matches while the engine is live, unpaused and under both caps
 * (a race past the pre-check trips the guard → 409, the caller retries).
 */
export function countEngineWrite(db: D1Database, engineId: string): D1PreparedStatement[] {
  const { hour, day } = buckets();
  return [
    db.prepare(
      `UPDATE engines SET
         hourly_count = CASE WHEN hour_bucket = ?1 THEN hourly_count + 1 ELSE 1 END, hour_bucket = ?1,
         day_count = CASE WHEN day_bucket = ?2 THEN day_count + 1 ELSE 1 END, day_bucket = ?2
       WHERE engine_id = ?3 AND revoked_at IS NULL AND paused = 0
         AND (hour_bucket IS NOT ?1 OR hourly_count < ?4) AND (day_bucket IS NOT ?2 OR day_count < ?5)`,
    ).bind(hour, day, engineId, HOURLY_CAP, DAILY_CAP),
    guard(db),
  ];
}
