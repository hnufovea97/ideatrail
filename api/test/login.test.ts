import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fromB64u } from "@ideatrail/crypto/bytes";
import { browser, fakeLimiter, signUp } from "./browser";

type Json = Record<string, unknown> & { error?: { code: string } };
const json = async (r: Response) => (await r.json()) as Json;

async function login(b: ReturnType<typeof browser>, auth: Awaited<ReturnType<typeof signUp>>["auth"], override: { signCount?: number; origin?: string } = {}) {
  const o = await json(await b.call("POST", "/v1/webauthn/login/options", {}));
  const resp = await auth.login(o.options as { challenge: string }, override);
  return b.call("POST", "/v1/webauthn/login/verify", { challenge_id: o.challenge_id, response: resp });
}

async function stepup(b: ReturnType<typeof browser>, auth: Awaited<ReturnType<typeof signUp>>["auth"], method: string, path: string) {
  const o = await json(await b.call("POST", "/v1/webauthn/stepup/options", { method, path }));
  return { challenge_id: o.challenge_id as string, response: await auth.login(o.options as { challenge: string }) };
}

describe("login, sessions, step-up (2.6)", () => {
  afterEach(() => vi.useRealTimers());

  it("login returns this credential's envelope and a new session", async () => {
    const { auth, userId } = await signUp();
    const b = browser();
    const r = await login(b, auth);
    expect(r.status).toBe(200);
    const body = await json(r);
    expect(body.user_id).toBe(userId);
    const wrapped = fromB64u((body.envelope as { wrapped_master_key: string }).wrapped_master_key);
    expect([...wrapped.subarray(0, 4)]).toEqual([0x49, 0x54, 0x31, 0x80]); // "IT1" + envelope kind
    expect(b.cookie).toMatch(/^__Host-it_s=/);
    expect((await b.call("GET", "/v1/account")).status).toBe(200);
  });

  it("a counter that goes backwards is rejected (cloned authenticator)", async () => {
    const { auth } = await signUp();
    expect((await login(browser(), auth, { signCount: 7 })).status).toBe(200);
    expect((await login(browser(), auth, { signCount: 6 })).status).toBe(400);
  });

  it("synced passkeys that always report 0 keep working", async () => {
    const { auth } = await signUp();
    expect((await login(browser(), auth, { signCount: 0 })).status).toBe(200);
    expect((await login(browser(), auth, { signCount: 0 })).status).toBe(200);
  });

  it("an unknown credential gets the same error as a bad signature", async () => {
    const { auth } = await signUp();
    await env.DB.prepare("DELETE FROM passkey_credentials WHERE credential_id = ?").bind(auth.id).run();
    const r = await login(browser(), auth);
    expect(r.status).toBe(400);
    expect((await json(r)).error!.code).toBe("webauthn_failed");
  });

  it("wrong origin fails", async () => {
    const { auth } = await signUp();
    expect((await login(browser(), auth, { origin: "https://evil.example" })).status).toBe(400);
  });

  it("sessions expire after 12 hours and are deleted", async () => {
    const { b, userId } = await signUp();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 12 * 3600 * 1000 + 1000);
    const r = await b.call("GET", "/v1/account");
    expect(r.status).toBe(401);
    expect((await json(r)).error!.code).toBe("session_required");
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?").bind(userId).first("n")).toBe(0);
  });

  it("GET /v1/account returns only the caller's account, without wrapped master keys", async () => {
    const a = await signUp();
    const b2 = await signUp();
    const mine = await json(await a.b.call("GET", "/v1/account"));
    const theirs = await json(await b2.b.call("GET", "/v1/account"));
    expect(mine.user_id).toBe(a.userId);
    expect(theirs.user_id).toBe(b2.userId);
    expect(mine.envelopes).toHaveLength(1);
    expect(JSON.stringify(mine)).not.toContain("wrapped_master_key");
    expect((mine.credentials as { credential_id: string }[])[0].credential_id).toBe(a.auth.id);
  });

  it("logout deletes the session", async () => {
    const { b } = await signUp();
    const cookie = b.cookie;
    expect((await b.call("POST", "/v1/logout", {})).status).toBe(200);
    b.cookie = cookie;
    expect((await b.call("GET", "/v1/account")).status).toBe(401);
  });

  it("a new login drops the browser's previous session", async () => {
    const { b, auth, userId } = await signUp();
    await login(b, auth);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?").bind(userId).first("n")).toBe(1);
  });

  describe("step-up", () => {
    it("no assertion → 401 stepup_required", async () => {
      const { b } = await signUp();
      const r = await b.call("POST", "/v1/__test/stepup", {});
      expect(r.status).toBe(401);
      expect((await json(r)).error!.code).toBe("stepup_required");
    });
    it("a valid assertion for this action passes once", async () => {
      const { b, auth } = await signUp();
      const assertion = await stepup(b, auth, "POST", "/v1/__test/stepup");
      expect((await b.call("POST", "/v1/__test/stepup", { assertion })).status).toBe(200);
      expect((await b.call("POST", "/v1/__test/stepup", { assertion })).status).toBe(401);
    });
    it("an assertion for another action is refused", async () => {
      const { b, auth } = await signUp();
      const assertion = await stepup(b, auth, "DELETE", "/v1/account");
      expect((await b.call("POST", "/v1/__test/stepup", { assertion })).status).toBe(401);
    });
    it("older than 2 minutes is refused", async () => {
      const { b, auth } = await signUp();
      const assertion = await stepup(b, auth, "POST", "/v1/__test/stepup");
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 121 * 1000);
      expect((await b.call("POST", "/v1/__test/stepup", { assertion })).status).toBe(401);
    });
    it("another user's challenge or passkey is refused", async () => {
      const a = await signUp();
      const other = await signUp();
      const theirs = await stepup(other.b, other.auth, "POST", "/v1/__test/stepup");
      expect((await a.b.call("POST", "/v1/__test/stepup", { assertion: theirs })).status).toBe(401);
      const o = await json(await a.b.call("POST", "/v1/webauthn/stepup/options", { method: "POST", path: "/v1/__test/stepup" }));
      const signedByOther = { challenge_id: o.challenge_id, response: await other.auth.login(o.options as { challenge: string }) };
      expect((await a.b.call("POST", "/v1/__test/stepup", { assertion: signedByOther })).status).toBe(401);
    });
  });

  it("login/options is rate limited per IP", async () => {
    const limiter = fakeLimiter(10);
    const b = browser({ limiter });
    for (let i = 0; i < 10; i++) expect((await b.call("POST", "/v1/webauthn/login/options", {})).status).toBe(200);
    const r = await b.call("POST", "/v1/webauthn/login/options", {});
    expect(r.status).toBe(429);
    expect([...limiter.calls.keys()]).toEqual(["login_options:203.0.113.7"]);
  });
});
