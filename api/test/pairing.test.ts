import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toB64u, toHex } from "@ideatrail/crypto/bytes";
import { createApp } from "../src/index";
import { browser, fakeLimiter, sealedB64u, signUp } from "./browser";
import { makeEngine, signedInit, type TestEngine } from "./engine";

type Json = Record<string, unknown> & { error?: { code: string } };
const json = async (r: Response) => (await r.json()) as Json;
const engineApp = () => createApp({ limiter: () => fakeLimiter(1000) });
const engineCall = (path: string, init: RequestInit) => engineApp().request(`https://api.test${path}`, init, env);

async function startPairing(e: TestEngine = makeEngine()) {
  const r = await engineCall("/v1/pairing", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ engine_id: e.engineId, sign_pubkey: toB64u(e.signPub), kem_pubkey: toB64u(e.kemPub) }) });
  return { e, r, sessionId: (await json(r)).session_id as string };
}

const deliverBody = (version: number) => ({ payload: sealedB64u(8, 80), mac: toHex(crypto.getRandomValues(new Uint8Array(32))), engine_list: sealedB64u(0x88), engine_list_version: version });

async function signedUpAndConfirmed(sessionId: string) {
  const s = await signUp(browser(), { sessionId });
  expect((await s.b.call("POST", "/v1/account/confirm", {})).status).toBe(200);
  return s;
}

describe("pairing (2.4)", () => {
  afterEach(() => vi.useRealTimers());

  it("full flow: engine start → signup → deliver → engine picks up the blob", async () => {
    const { e, r, sessionId } = await startPairing();
    expect(r.status).toBe(201);
    const page = await json(await browser().call("GET", `/v1/pairing/${sessionId}`));
    expect(page).toMatchObject({ engine_id: e.engineId, sign_pubkey: toB64u(e.signPub), kem_pubkey: toB64u(e.kemPub), delivered: false });

    const { b, userId } = await signedUpAndConfirmed(sessionId);
    const body = deliverBody(1);
    const d = await b.call("POST", `/v1/pairing/${sessionId}/deliver`, body);
    expect(d.status).toBe(200);
    expect(await env.DB.prepare("SELECT user_id FROM engines WHERE engine_id = ?").bind(e.engineId).first("user_id")).toBe(userId);
    expect(await env.DB.prepare("SELECT kind FROM connectors WHERE connector_id = ?").bind(e.engineId).first("kind")).toBe("local");
    expect(await env.DB.prepare("SELECT engine_list_version FROM users WHERE user_id = ?").bind(userId).first("engine_list_version")).toBe(1);

    const path = `/v1/pairing/${sessionId}/blob`;
    const blob = await engineCall(path, signedInit(e, "GET", path, "", 1n));
    expect(blob.status).toBe(200);
    expect(await json(blob)).toEqual({ user_id: userId, payload: body.payload, mac: body.mac });
  });

  it("the engines row inherits the pairing session's request sequence", async () => {
    const { e, sessionId } = await startPairing();
    const path = `/v1/pairing/${sessionId}/blob`;
    expect((await engineCall(path, signedInit(e, "GET", path, "", 3n))).status).toBe(404); // not delivered yet, but seq 3 used
    const { b } = await signedUpAndConfirmed(sessionId);
    await b.call("POST", `/v1/pairing/${sessionId}/deliver`, deliverBody(1));
    expect(await env.DB.prepare("SELECT last_req_seq FROM engines WHERE engine_id = ?").bind(e.engineId).first("last_req_seq")).toBe(3);
  });

  it("an engine id can start pairing only once", async () => {
    const e = makeEngine();
    expect((await startPairing(e)).r.status).toBe(201);
    expect((await startPairing(e)).r.status).toBe(409);
  });

  it("rejects public keys that are not 32 bytes", async () => {
    const e = makeEngine();
    const r = await engineCall("/v1/pairing", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ engine_id: e.engineId, sign_pubkey: toB64u(e.signPub.subarray(0, 31)), kem_pubkey: toB64u(e.kemPub) }) });
    expect(r.status).toBe(400);
  });

  it("deliver after 10 minutes → 410; the page also reports expiry", async () => {
    const { sessionId } = await startPairing();
    const { b } = await signedUpAndConfirmed(sessionId);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1000);
    expect((await b.call("POST", `/v1/pairing/${sessionId}/deliver`, deliverBody(1))).status).toBe(410);
    expect((await browser().call("GET", `/v1/pairing/${sessionId}`)).status).toBe(410);
  });

  it("deliver works once", async () => {
    const { sessionId } = await startPairing();
    const { b } = await signedUpAndConfirmed(sessionId);
    expect((await b.call("POST", `/v1/pairing/${sessionId}/deliver`, deliverBody(1))).status).toBe(200);
    expect((await b.call("POST", `/v1/pairing/${sessionId}/deliver`, deliverBody(2))).status).toBe(409);
  });

  it("another account cannot deliver to someone else's pairing", async () => {
    const { sessionId } = await startPairing();
    await signedUpAndConfirmed(sessionId);
    const other = await signUp();
    await other.b.call("POST", "/v1/account/confirm", {});
    expect((await other.b.call("POST", `/v1/pairing/${sessionId}/deliver`, deliverBody(1))).status).toBe(403);
  });

  it("unconfirmed accounts cannot deliver", async () => {
    const { sessionId } = await startPairing();
    const { b } = await signUp(browser(), { sessionId });
    expect((await b.call("POST", `/v1/pairing/${sessionId}/deliver`, deliverBody(1))).status).toBe(403);
  });

  it("engine_list_version must be exactly previous + 1 (no rollback, no skipping)", async () => {
    for (const v of [0, 2]) {
      const { sessionId } = await startPairing();
      const { b, userId } = await signedUpAndConfirmed(sessionId);
      const r = await b.call("POST", `/v1/pairing/${sessionId}/deliver`, deliverBody(v));
      expect([400, 409], `version ${v}`).toContain(r.status); // 0 fails validation, 2 fails the N+1 check
      expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM engines WHERE user_id = ?").bind(userId).first("n")).toBe(0);
    }
  });

  it("two concurrent delivers: exactly one succeeds, and nothing half-applies", async () => {
    const { e, sessionId } = await startPairing();
    const { b } = await signedUpAndConfirmed(sessionId);
    const results = await Promise.all([b.call("POST", `/v1/pairing/${sessionId}/deliver`, deliverBody(1)), b.call("POST", `/v1/pairing/${sessionId}/deliver`, deliverBody(1))]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM engines WHERE engine_id = ?").bind(e.engineId).first("n")).toBe(1);
  });

  it("blob: another engine's signature is refused", async () => {
    const { sessionId } = await startPairing();
    const { b } = await signedUpAndConfirmed(sessionId);
    await b.call("POST", `/v1/pairing/${sessionId}/deliver`, deliverBody(1));
    const path = `/v1/pairing/${sessionId}/blob`;
    expect((await engineCall(path, signedInit(makeEngine(), "GET", path, "", 1n))).status).toBe(401);
  });

  it("pairing start is IP-rate-limited", async () => {
    const limiter = fakeLimiter(2);
    const app = createApp({ limiter: () => limiter });
    const post = () => { const e = makeEngine(); return app.request("https://api.test/v1/pairing", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.1" },
      body: JSON.stringify({ engine_id: e.engineId, sign_pubkey: toB64u(e.signPub), kem_pubkey: toB64u(e.kemPub) }) }, env); };
    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(429);
  });
});
