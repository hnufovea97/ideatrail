import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accountPayload, browser, RP, sealedB64u, signUp } from "./browser";
import { createAuthenticator } from "./authenticator";
import { seedPairing } from "./engine";

const count = (table: string, where = "1=1", ...args: unknown[]) =>
  env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).bind(...args).first("n");

async function start(b = browser()) {
  const pairing = await seedPairing();
  const auth = await createAuthenticator(RP);
  const r = await b.call("POST", "/v1/webauthn/register/options", { pairing_session_id: pairing.sessionId });
  expect(r.status).toBe(200);
  const body = (await r.json()) as { challenge_id: string; user_id: string; options: { challenge: string; user: { id: string }; authenticatorSelection: Record<string, string>; pubKeyCredParams: { alg: number }[] } };
  return { b, auth, pairing, ...body };
}

describe("signup (2.5)", () => {
  afterEach(() => vi.useRealTimers());

  it("creates an unconfirmed account, credential, envelope and a strict session cookie", async () => {
    const s = await start();
    expect(s.options.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "required" });
    expect(s.options.pubKeyCredParams.map((p) => p.alg).sort((a, b) => a - b)).toEqual([-8, -7]);
    const r = await s.b.call("POST", "/v1/webauthn/register/verify", { challenge_id: s.challenge_id, response: await s.auth.register(s.options), ...accountPayload() });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ user_id: s.user_id });
    const set = r.headers.get("set-cookie")!;
    for (const part of ["__Host-it_s=", "Path=/", "HttpOnly", "Secure", "SameSite=Strict", "Max-Age=43200"]) expect(set).toContain(part);
    expect(await count("users", "user_id = ? AND confirmed_at IS NULL", s.user_id)).toBe(1);
    expect(await count("passkey_credentials", "user_id = ?", s.user_id)).toBe(1);
    expect(await count("key_envelopes", "user_id = ? AND method = 'passkey'", s.user_id)).toBe(1);
    expect(await env.DB.prepare("SELECT user_id FROM pairing_sessions WHERE session_id = ?").bind(s.pairing.sessionId).first("user_id")).toBe(s.user_id);
  });

  it("stores only a hash of the session cookie", async () => {
    const { b, userId } = await signUp();
    const token = b.cookie.split("=")[1];
    const ids = await env.DB.prepare("SELECT session_id FROM sessions WHERE user_id = ?").bind(userId).all<{ session_id: string }>();
    expect(ids.results).toHaveLength(1);
    expect(ids.results[0].session_id).toMatch(/^[0-9a-f]{64}$/);
    expect(ids.results[0].session_id).not.toContain(token);
  });

  it("a challenge works once", async () => {
    const s = await start();
    const resp = await s.auth.register(s.options);
    expect((await s.b.call("POST", "/v1/webauthn/register/verify", { challenge_id: s.challenge_id, response: resp, ...accountPayload() })).status).toBe(200);
    const again = await browser().call("POST", "/v1/webauthn/register/verify", { challenge_id: s.challenge_id, response: resp, ...accountPayload() });
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe("challenge_invalid");
  });

  it("the same credential cannot sign up twice", async () => {
    const s = await start();
    expect((await s.b.call("POST", "/v1/webauthn/register/verify", { challenge_id: s.challenge_id, response: await s.auth.register(s.options), ...accountPayload() })).status).toBe(200);
    const p2 = await seedPairing();
    const b2 = browser();
    const o2 = (await (await b2.call("POST", "/v1/webauthn/register/options", { pairing_session_id: p2.sessionId })).json()) as { challenge_id: string; user_id: string; options: { challenge: string } };
    const r = await b2.call("POST", "/v1/webauthn/register/verify", { challenge_id: o2.challenge_id, response: await s.auth.register(o2.options), ...accountPayload() });
    expect(r.status).toBe(409);
    expect(await count("users", "user_id = ?", o2.user_id)).toBe(0);
  });

  it("expired challenges are rejected", async () => {
    const s = await start();
    const resp = await s.auth.register(s.options);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1000);
    expect((await s.b.call("POST", "/v1/webauthn/register/verify", { challenge_id: s.challenge_id, response: resp, ...accountPayload() })).status).toBe(400);
  });

  it("a response made for another origin fails", async () => {
    const s = await start();
    const r = await s.b.call("POST", "/v1/webauthn/register/verify", { challenge_id: s.challenge_id, response: await s.auth.register(s.options, { origin: "https://evil.example" }), ...accountPayload() });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("webauthn_failed");
  });

  it("non-'none' attestation and missing user verification are rejected", async () => {
    for (const override of [{ fmt: "packed" }, { uv: false }]) {
      const s = await start();
      const r = await s.b.call("POST", "/v1/webauthn/register/verify", { challenge_id: s.challenge_id, response: await s.auth.register(s.options, override), ...accountPayload() });
      expect(r.status, JSON.stringify(override)).toBe(400);
    }
  });

  it("malformed account material is rejected and nothing is written", async () => {
    const bad = [
      { ...accountPayload(), envelope: { envelope_id: "x", wrapped_master_key: sealedB64u(0x80) } },
      { ...accountPayload(), envelope: { envelope_id: accountPayload().envelope.envelope_id, wrapped_master_key: sealedB64u(0x81) } },
      { ...accountPayload(), account: { account_pubkey: "AAAA", wrapped_account_privkey: sealedB64u(0x81) } },
    ];
    for (const payload of bad) {
      const s = await start();
      const r = await s.b.call("POST", "/v1/webauthn/register/verify", { challenge_id: s.challenge_id, response: await s.auth.register(s.options), ...payload });
      expect(r.status).toBe(400);
      expect(await count("users", "user_id = ?", s.user_id)).toBe(0);
    }
  });

  it("a pairing session already bound to an account cannot start another signup", async () => {
    const { b, pairing } = await signUp();
    const r = await b.call("POST", "/v1/webauthn/register/options", { pairing_session_id: pairing.sessionId });
    expect(r.status).toBe(409);
  });

  it("two concurrent signups on one pairing session: exactly one account", async () => {
    const pairing = await seedPairing();
    const run = async () => {
      const b = browser();
      const auth = await createAuthenticator(RP);
      const o = (await (await b.call("POST", "/v1/webauthn/register/options", { pairing_session_id: pairing.sessionId })).json()) as { challenge_id: string; options: { challenge: string } };
      return { b, o, resp: await auth.register(o.options) };
    };
    const [x, y] = await Promise.all([run(), run()]);
    const results = await Promise.all([x, y].map((s) => s.b.call("POST", "/v1/webauthn/register/verify", { challenge_id: s.o.challenge_id, response: s.resp, ...accountPayload() })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("expired pairing sessions cannot start signup", async () => {
    const pairing = await seedPairing({ expired: true });
    expect((await browser().call("POST", "/v1/webauthn/register/options", { pairing_session_id: pairing.sessionId })).status).toBe(410);
  });

  it("browser writes need the app Origin and JSON", async () => {
    const pairing = await seedPairing();
    expect((await browser({ origin: "https://evil.example" }).call("POST", "/v1/webauthn/register/options", { pairing_session_id: pairing.sessionId })).status).toBe(403);
    const b = browser();
    const r = await b.app.request("https://api.test/v1/webauthn/register/options", { method: "POST", headers: { origin: "http://localhost:4321", "content-type": "text/plain" }, body: "{}" }, env);
    expect(r.status).toBe(415);
  });

  it("confirm: unconfirmed accounts are blocked until /v1/account/confirm", async () => {
    const { b } = await signUp();
    expect((await b.call("GET", "/v1/__test/confirmed-only")).status).toBe(403);
    expect((await b.call("POST", "/v1/account/confirm", {})).status).toBe(200);
    expect((await b.call("GET", "/v1/__test/confirmed-only")).status).toBe(200);
    expect((await b.call("POST", "/v1/account/confirm", {})).status).toBe(200); // idempotent
  });

  it("confirm without a session → 401", async () => {
    expect((await browser().call("POST", "/v1/account/confirm", {})).status).toBe(401);
  });
});
