import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { ApiError } from "../http/errors";
import { browserWrite } from "../http/browser";
import { readJson, zSealedMax } from "../http/validate";
import { endSession, requireConfirmed } from "../auth/session";
import { requireStepup } from "../auth/stepup";
import { CURSOR_SQL, guard, writeWithCursor } from "../db/change";
import { nowIso } from "../db/values";
import { revokeGithubToken, type Fetcher } from "../github";

const RELOCK_ENGINE_LIST = 0x88;
const zToken = z.string().min(1).max(255);

const zRevoke = z.object({
  engine_list: zSealedMax(RELOCK_ENGINE_LIST, 16 * 1024),
  engine_list_version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  github_token: zToken.optional(),
});

const notFound = () => new ApiError(404, "engine_not_found", "No such engine");
const listConflict = () => new ApiError(409, "engine_list_conflict", "Engine list changed on another device; reload and retry");

export function engineRoutes(fetcher?: Fetcher) {
  const r = new Hono<AppEnv>();

  /**
   * Disconnect an engine (step-up): signing key revoked, storage link and pending approvals closed,
   * inbox emptied, engine list N→N+1 — one batch. Then one GitHub token revocation (best effort).
   * Calling again on an already revoked engine only retries the GitHub revocation.
   */
  r.post("/:id/revoke", browserWrite, requireConfirmed, requireStepup, async (c) => {
    const b = await readJson(c, zRevoke);
    const db = c.env.DB;
    const userId = c.get("userId")!;
    const engineId = c.req.param("id");
    const engine = await db.prepare("SELECT revoked_at FROM engines WHERE engine_id = ? AND user_id = ?").bind(engineId, userId).first<{ revoked_at: string | null }>();
    if (!engine) throw notFound();
    if (!engine.revoked_at) {
      const prev = await db.prepare("SELECT engine_list_version FROM users WHERE user_id = ?").bind(userId).first<number>("engine_list_version");
      if (prev === null || b.engine_list_version !== prev + 1) throw listConflict();
      const now = nowIso();
      await writeWithCursor(db, userId, [
        db.prepare("UPDATE users SET engine_list = ?, engine_list_version = ? WHERE user_id = ? AND engine_list_version = ?").bind(b.engine_list, b.engine_list_version, userId, prev),
        guard(db),
        db.prepare(`UPDATE engines SET revoked_at = ?, change_seq = ${CURSOR_SQL} WHERE engine_id = ? AND user_id = ? AND revoked_at IS NULL`).bind(now, userId, engineId, userId),
        guard(db),
        db.prepare("UPDATE connectors SET revoked_at = ? WHERE connector_id = ? AND user_id = ?").bind(now, engineId, userId),
        db.prepare(`UPDATE storage_links SET revoked_at = ?, change_seq = ${CURSOR_SQL} WHERE engine_id = ? AND user_id = ? AND revoked_at IS NULL`).bind(now, userId, engineId, userId),
        db.prepare(`UPDATE pending_approvals SET status = 'rejected', decided_at = ?, change_seq = ${CURSOR_SQL} WHERE engine_id = ? AND user_id = ? AND status = 'pending'`).bind(now, userId, engineId, userId),
        db.prepare("DELETE FROM engine_inbox WHERE engine_id = ? AND user_id = ?").bind(engineId, userId),
        db.prepare("INSERT INTO audit_log (user_id, actor, action, target_id, at) VALUES (?, 'browser', 'engine.revoke', ?, ?)").bind(userId, engineId, now),
      ], listConflict());
    }
    // Only for an engine that actually had a GitHub link (no arbitrary-token revocation oracle).
    const hadLink = await db.prepare("SELECT 1 FROM storage_links WHERE engine_id = ? AND user_id = ?").bind(engineId, userId).first();
    const githubRevoked = b.github_token && hadLink ? await revokeGithubToken(c.env, b.github_token, fetcher) : null;
    return c.json({ engine_id: engineId, revoked: true, github_revoked: githubRevoked });
  });

  /** Un-pause after the "is this engine yours?" check. Revoked engines stay revoked (no resurrection). */
  r.post("/:id/resume", browserWrite, requireConfirmed, requireStepup, async (c) => {
    const userId = c.get("userId")!;
    await writeWithCursor(c.env.DB, userId, [
      c.env.DB.prepare(`UPDATE engines SET paused = 0, pause_reason = NULL, hourly_count = 0, day_count = 0, change_seq = ${CURSOR_SQL}
                        WHERE engine_id = ? AND user_id = ? AND revoked_at IS NULL`).bind(userId, c.req.param("id"), userId),
      guard(c.env.DB),
    ], notFound());
    return c.json({ resumed: true });
  });

  return r;
}

const zDeleteAccount = z.object({ github_tokens: z.array(zToken).max(10).optional() });

/**
 * DELETE /v1/account (step-up): best-effort GitHub token revocation, then one cascading delete of
 * every row of this account, then the session cookie is cleared.
 */
export const deleteAccountHandlers = (fetcher?: Fetcher) => [browserWrite, requireConfirmed, requireStepup, async (c: Context<AppEnv>) => {
  const b = await readJson(c, zDeleteAccount);
  const userId = c.get("userId")!;
  let githubRevoked = 0;
  for (const token of b.github_tokens ?? []) if (await revokeGithubToken(c.env, token, fetcher)) githubRevoked++;
  await c.env.DB.prepare("DELETE FROM users WHERE user_id = ?").bind(userId).run();
  await endSession(c);
  return c.json({ deleted: true, github_revoked: githubRevoked });
}] as const;
