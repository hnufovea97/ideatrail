import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { toB64u, toHex } from "@ideatrail/crypto/bytes";
import { ApiError } from "../http/errors";
import { inSeconds, nowIso } from "../db/values";
import type { AppEnv } from "../env";

export const SESSION_SECONDS = 12 * 60 * 60;
const COOKIE = "it_s"; // sent as __Host-it_s

const hashToken = async (token: string) => toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))));

/**
 * Create a session: returns the INSERT for the caller's batch and sets the cookie on success.
 * Only the SHA-256 of the cookie value is stored. Any session the browser already had is dropped.
 */
export async function newSession(c: Context<AppEnv>, userId: string) {
  const previous = getCookie(c, COOKIE, "host");
  const token = toB64u(crypto.getRandomValues(new Uint8Array(32)));
  const stmts = [
    c.env.DB.prepare("INSERT INTO sessions (session_id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind(await hashToken(token), userId, nowIso(), inSeconds(SESSION_SECONDS)),
  ];
  if (previous) stmts.push(c.env.DB.prepare("DELETE FROM sessions WHERE session_id = ?").bind(await hashToken(previous)));
  const commit = () =>
    setCookie(c, COOKIE, token, { prefix: "host", httpOnly: true, secure: true, sameSite: "Strict", path: "/", maxAge: SESSION_SECONDS });
  return { stmts, commit };
}

const sessionRequired = () => new ApiError(401, "session_required", "Sign in again");

/** Cookie session → c.var.userId. Expired sessions are deleted and rejected. */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, COOKIE, "host");
  if (!token) throw sessionRequired();
  const id = await hashToken(token);
  const row = await c.env.DB.prepare("SELECT user_id, expires_at FROM sessions WHERE session_id = ?").bind(id).first<{ user_id: string; expires_at: string }>();
  if (!row) throw sessionRequired();
  if (row.expires_at <= nowIso()) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE session_id = ?").bind(id).run();
    throw sessionRequired();
  }
  c.set("userId", row.user_id);
  await next();
};

/** Session whose account finished signup ("unwrapped once" — spec §11). */
export const requireConfirmed: MiddlewareHandler<AppEnv> = async (c, next) => {
  await requireSession(c, async () => {
    const confirmed = await c.env.DB.prepare("SELECT confirmed_at FROM users WHERE user_id = ?").bind(c.get("userId")).first("confirmed_at");
    if (!confirmed) throw new ApiError(403, "account_unconfirmed", "Finish signup first");
    await next();
  });
};

export async function endSession(c: Context<AppEnv>) {
  const token = getCookie(c, COOKIE, "host");
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE session_id = ?").bind(await hashToken(token)).run();
  deleteCookie(c, COOKIE, { prefix: "host", path: "/", secure: true });
}

/** Hash id of this request's own session (null without a cookie). */
export async function currentSessionId(c: Context<AppEnv>): Promise<string | null> {
  const token = getCookie(c, COOKIE, "host");
  return token ? hashToken(token) : null;
}
