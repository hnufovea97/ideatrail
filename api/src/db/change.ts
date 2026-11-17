import { ApiError } from "../http/errors";

/**
 * SQL for "this account's cursor after the bump". Bind the user_id for the `?` where you use it.
 * Only valid inside writeWithCursor's batch, after the bump statement.
 */
export const CURSOR_SQL = "(SELECT change_seq FROM users WHERE user_id = ?)";

const GUARD_SQL = "SELECT CASE WHEN changes() = 0 THEN json('guard_failed') END";
const GUARD_ERROR = /malformed JSON/;

/**
 * Put right after a conditional UPDATE/INSERT: if that statement changed no rows, the batch fails
 * and D1 rolls every statement back (a no-op UPDATE alone does not fail a batch).
 */
export const guard = (db: D1Database): D1PreparedStatement => db.prepare(GUARD_SQL);

/**
 * Run statements as one atomic batch, mapping a tripped guard to `conflict` (409 by default).
 */
export async function runBatch(db: D1Database, stmts: D1PreparedStatement[], conflict = new ApiError(409, "conflict", "State changed; reload and retry")) {
  try {
    return await db.batch(stmts);
  } catch (err) {
    if (err instanceof Error && GUARD_ERROR.test(err.message)) throw conflict;
    throw err;
  }
}

/**
 * Bump users.change_seq once and run `stmts` in the same atomic batch (spec §8: no BEGIN/COMMIT).
 * Statements stamp rows with CURSOR_SQL so /v1/sync can return "changed since cursor".
 */
export function writeWithCursor(db: D1Database, userId: string, stmts: D1PreparedStatement[], conflict?: ApiError) {
  const bump = db.prepare("UPDATE users SET change_seq = change_seq + 1 WHERE user_id = ?").bind(userId);
  return runBatch(db, [bump, guard(db), ...stmts], conflict);
}
