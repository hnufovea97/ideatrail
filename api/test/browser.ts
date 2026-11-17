import { env } from "cloudflare:workers";
import { toB64u, concat } from "@ideatrail/crypto/bytes";
import { newId } from "@ideatrail/crypto/ids";
import { createApp } from "../src/index";
import type { Limiter } from "../src/http/rate-limit";
import { createAuthenticator } from "./authenticator";
import { seedPairing } from "./engine";

export const APP_ORIGIN = "http://localhost:4321";
export const RP = { rpId: "localhost", origin: APP_ORIGIN };

/** Counts calls per key; denies after `max`. */
export function fakeLimiter(max = 10): Limiter & { calls: Map<string, number> } {
  const calls = new Map<string, number>();
  return { calls, allow: async (k) => { const n = (calls.get(k) ?? 0) + 1; calls.set(k, n); return n <= max; } };
}

/** A browser: sends Origin + JSON, keeps the session cookie between calls. */
export function browser(opts: { limiter?: Limiter; origin?: string } = {}) {
  const app = createApp({ limiter: () => opts.limiter ?? fakeLimiter(1000) });
  let cookie = "";
  async function call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { origin: opts.origin ?? APP_ORIGIN, "cf-connecting-ip": "203.0.113.7", ...extra };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (cookie) headers.cookie = cookie;
    const res = await app.request(`https://api.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.includes("Max-Age=0") ? "" : set.split(";")[0];
    return res;
  }
  return { app, call, get cookie() { return cookie; }, set cookie(v: string) { cookie = v; }, rawSetCookie: () => cookie };
}

export const sealedB64u = (kind: number, len = 40) => toB64u(concat(Uint8Array.of(0x49, 0x54, 0x31, kind), crypto.getRandomValues(new Uint8Array(len))));
export const pubB64u = () => toB64u(crypto.getRandomValues(new Uint8Array(32)));

export function accountPayload() {
  return {
    account: { account_pubkey: pubB64u(), wrapped_account_privkey: sealedB64u(0x81) },
    envelope: { envelope_id: newId(), wrapped_master_key: sealedB64u(0x80, 72) },
  };
}

/** Full signup through a fresh pairing session. Returns the browser (signed in), authenticator and ids. */
export async function signUp(b = browser()) {
  const pairing = await seedPairing();
  const auth = await createAuthenticator(RP);
  const o = await b.call("POST", "/v1/webauthn/register/options", { pairing_session_id: pairing.sessionId });
  const { challenge_id, user_id, options } = (await o.json()) as { challenge_id: string; user_id: string; options: { challenge: string; user: { id: string } } };
  const res = await b.call("POST", "/v1/webauthn/register/verify", { challenge_id, response: await auth.register(options), ...accountPayload() });
  if (res.status !== 200) throw new Error(`signup failed ${res.status} ${await res.text()}`);
  return { b, auth, userId: user_id, pairing };
}
