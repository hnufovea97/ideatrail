import { Hono } from "hono";
import { toB64u } from "@ideatrail/crypto/bytes";
import type { AppEnv } from "../env";
import { browserWrite } from "../http/browser";
import { endSession, requireSession } from "../auth/session";
import { nowIso, toBytes } from "../db/values";

const b64 = (v: unknown) => (v === null || v === undefined ? null : toB64u(toBytes(v)));

export function accountRoutes() {
  const r = new Hono<AppEnv>();
  r.use("*", browserWrite);

  /** "Unwrapped the envelope once on this device" → account may record (spec §11). Idempotent. */
  r.post("/confirm", requireSession, async (c) => {
    await c.env.DB.prepare("UPDATE users SET confirmed_at = COALESCE(confirmed_at, ?) WHERE user_id = ?").bind(nowIso(), c.get("userId")).run();
    return c.json({ confirmed: true });
  });

  /** The signed-in account's sealed material and metadata. Never the wrapped master keys. */
  r.get("/", requireSession, async (c) => {
    const userId = c.get("userId")!;
    const db = c.env.DB;
    const [user, envelopes, credentials] = await db.batch([
      db.prepare(`SELECT user_id, account_pubkey, wrapped_account_privkey, engine_list, engine_list_version, recall_notes,
        reminder_state, view_prefs, recovery_key_status, auto_lock_minutes, confirmed_at, created_at FROM users WHERE user_id = ?`).bind(userId),
      db.prepare("SELECT envelope_id, method, label, created_at, last_used_at FROM key_envelopes WHERE user_id = ? ORDER BY created_at").bind(userId),
      db.prepare("SELECT credential_id, aaguid, created_at, last_used_at FROM passkey_credentials WHERE user_id = ? ORDER BY created_at").bind(userId),
    ]);
    const u = user.results[0] as Record<string, unknown>;
    return c.json({
      user_id: u.user_id,
      account_pubkey: b64(u.account_pubkey),
      wrapped_account_privkey: b64(u.wrapped_account_privkey),
      engine_list: b64(u.engine_list),
      engine_list_version: u.engine_list_version,
      recall_notes: b64(u.recall_notes),
      reminder_state: b64(u.reminder_state),
      view_prefs: b64(u.view_prefs),
      recovery_key_status: u.recovery_key_status,
      auto_lock_minutes: u.auto_lock_minutes,
      confirmed_at: u.confirmed_at,
      created_at: u.created_at,
      envelopes: (envelopes.results as Record<string, unknown>[]).map((e) => ({ ...e, label: b64(e.label) })),
      credentials: credentials.results,
    });
  });

  return r;
}

/** POST /v1/logout — registered on its own path so its middleware does not cover other /v1 routes. */
export const logoutHandlers = [browserWrite, requireSession, async (c: import("hono").Context<AppEnv>) => {
  await endSession(c);
  return c.json({ signed_out: true });
}] as const;
