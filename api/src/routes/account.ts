import { Hono } from "hono";
import type { AppEnv } from "../env";
import { browserWrite } from "../http/browser";
import { requireSession } from "../auth/session";
import { nowIso } from "../db/values";

export function accountRoutes() {
  const r = new Hono<AppEnv>();
  r.use("*", browserWrite);

  /** "Unwrapped the envelope once on this device" → account may record (spec §11). Idempotent. */
  r.post("/confirm", requireSession, async (c) => {
    await c.env.DB.prepare("UPDATE users SET confirmed_at = COALESCE(confirmed_at, ?) WHERE user_id = ?").bind(nowIso(), c.get("userId")).run();
    return c.json({ confirmed: true });
  });

  return r;
}
