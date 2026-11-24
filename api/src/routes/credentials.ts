import { Hono } from "hono";
import type { AppEnv } from "../env";
import { ApiError } from "../http/errors";
import { browserWrite } from "../http/browser";
import { currentSessionId, requireConfirmed } from "../auth/session";
import { requireStepup } from "../auth/stepup";
import { nowIso } from "../db/values";

export function credentialRoutes() {
  const r = new Hono<AppEnv>();

  /**
   * Remove one device lock (step-up). Its key envelope goes with it (cascade). The account's last
   * credential is never removed: the count is part of the DELETE itself, so two concurrent removals
   * cannot both pass.
   */
  r.post("/:id/remove", browserWrite, requireConfirmed, requireStepup, async (c) => {
    const db = c.env.DB;
    const userId = c.get("userId")!;
    const credentialId = c.req.param("id");
    const exists = await db.prepare("SELECT 1 FROM passkey_credentials WHERE credential_id = ? AND user_id = ?").bind(credentialId, userId).first();
    if (!exists) throw new ApiError(404, "credential_not_found", "No such device");
    // Sessions are not tied to the credential they opened with, so every other session of this account ends
    // in the same batch (the current one stays). The sessions DELETE only runs if the credential row went.
    const own = (await currentSessionId(c)) ?? "";
    const [res] = await db.batch([
      db.prepare(
        `DELETE FROM passkey_credentials WHERE credential_id = ?1 AND user_id = ?2
           AND (SELECT COUNT(*) FROM passkey_credentials WHERE user_id = ?2) > 1`,
      ).bind(credentialId, userId),
      db.prepare("DELETE FROM sessions WHERE user_id = ?1 AND session_id <> ?2 AND changes() > 0").bind(userId, own),
    ]);
    if (res.meta.changes === 0) throw new ApiError(409, "last_device", "This is the only device lock; add another before removing it");
    await db.prepare("INSERT INTO audit_log (user_id, actor, action, target_id, at) VALUES (?, 'browser', 'credential.remove', ?, ?)").bind(userId, credentialId, nowIso()).run();
    return c.json({ removed: true });
  });

  return r;
}
