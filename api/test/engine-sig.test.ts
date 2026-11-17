import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../src/env";
import { MAX_SEQ, requireEngine, requirePairingEngine } from "../src/auth/engine-sig";
import { onError } from "../src/http/errors";
import { limitBody } from "../src/http/middleware";
import { makeEngine, seedEngine, seedPairing, signedInit } from "./engine";

function app() {
  const a = new Hono<AppEnv>();
  a.onError(onError);
  a.use("*", limitBody);
  a.post("/v1/echo", requireEngine, async (c) => c.json({ engine: c.get("engineId"), user: c.get("userId"), body: await c.req.text() }));
  a.get("/v1/pairing/:id/blob", requirePairingEngine, (c) => c.json({ ok: true }));
  return a;
}
const call = (path: string, init: RequestInit) => app().request(path, init, env);
const lastSeq = (id: string) => env.DB.prepare("SELECT CAST(last_req_seq AS TEXT) AS s FROM engines WHERE engine_id = ?").bind(id).first("s");

describe("engine signature (2.3)", () => {
  it("accepts a valid request, exposes engine and user, advances last_req_seq", async () => {
    const e = await seedEngine();
    const r = await call("/v1/echo?x=1", signedInit(e, "POST", "/v1/echo?x=1", '{"a":1}', 1n));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ engine: e.engineId, user: e.userId, body: '{"a":1}' });
    expect(await lastSeq(e.engineId)).toBe("1");
  });

  it("rejects replaying the same req_seq, and a lower one", async () => {
    const e = await seedEngine();
    const init = signedInit(e, "POST", "/v1/echo", "{}", 5n);
    expect((await call("/v1/echo", init)).status).toBe(200);
    expect((await call("/v1/echo", init)).status).toBe(401);
    expect((await call("/v1/echo", signedInit(e, "POST", "/v1/echo", "{}", 4n))).status).toBe(401);
  });

  it("accepts req_seq up to 2^63-1 and rejects 2^63", async () => {
    const e = await seedEngine();
    expect((await call("/v1/echo", signedInit(e, "POST", "/v1/echo", "{}", MAX_SEQ))).status).toBe(200);
    expect(await lastSeq(e.engineId)).toBe(MAX_SEQ.toString());
    const f = await seedEngine();
    expect((await call("/v1/echo", signedInit(f, "POST", "/v1/echo", "{}", MAX_SEQ + 1n))).status).toBe(401);
  });

  it("rejects timestamps more than 5 minutes off", async () => {
    const e = await seedEngine();
    const now = BigInt(Math.floor(Date.now() / 1000));
    expect((await call("/v1/echo", signedInit(e, "POST", "/v1/echo", "{}", 1n, now - 301n))).status).toBe(401);
    expect((await call("/v1/echo", signedInit(e, "POST", "/v1/echo", "{}", 2n, now + 301n))).status).toBe(401);
    expect((await call("/v1/echo", signedInit(e, "POST", "/v1/echo", "{}", 3n, now - 299n))).status).toBe(200);
  });

  it("rejects revoked engines", async () => {
    const e = await seedEngine({ revoked: true });
    expect((await call("/v1/echo", signedInit(e, "POST", "/v1/echo", "{}", 1n))).status).toBe(401);
  });

  it("rejects another key's signature and does NOT burn the victim's seq", async () => {
    const victim = await seedEngine();
    const attacker = makeEngine();
    const forged = signedInit({ ...attacker, engineId: victim.engineId }, "POST", "/v1/echo", "{}", 9n);
    expect((await call("/v1/echo", forged)).status).toBe(401);
    expect(await lastSeq(victim.engineId)).toBe("0");
    expect((await call("/v1/echo", signedInit(victim, "POST", "/v1/echo", "{}", 1n))).status).toBe(200);
  });

  it("rejects a body, path or method that differs from what was signed", async () => {
    const e = await seedEngine();
    const init = signedInit(e, "POST", "/v1/echo", '{"a":1}', 1n);
    expect((await call("/v1/echo", { ...init, body: '{"a":2}' })).status).toBe(401);
    expect((await call("/v1/echo?x=2", init)).status).toBe(401);
  });

  it("rejects missing or malformed headers", async () => {
    expect((await call("/v1/echo", { method: "POST", body: "{}" })).status).toBe(401);
    const e = await seedEngine();
    for (const [k, v] of [["x-it-seq", "-1"], ["x-it-seq", "01"], ["x-it-ts", "abc"], ["x-it-sig", "!!"], ["x-it-engine", "short"]]) {
      const init = signedInit(e, "POST", "/v1/echo", "{}", 1n);
      (init.headers as Record<string, string>)[k] = v;
      expect((await call("/v1/echo", init)).status, `${k}=${v}`).toBe(401);
    }
  });

  it("oversized bodies are cut off before signature checks", async () => {
    const e = await seedEngine();
    const big = "x".repeat(65 * 1024);
    expect((await call("/v1/echo", signedInit(e, "POST", "/v1/echo", big, 1n))).status).toBe(413);
  });

  it("pairing sessions: seq 1 passes, 0 or a repeat fails, wrong engine fails", async () => {
    const p = await seedPairing();
    const path = `/v1/pairing/${p.sessionId}/blob`;
    expect((await call(path, signedInit(p, "GET", path, "", 0n))).status).toBe(401);
    const ok = signedInit(p, "GET", path, "", 1n);
    expect((await call(path, ok)).status).toBe(200);
    expect((await call(path, ok)).status).toBe(401);
    const other = makeEngine();
    expect((await call(path, signedInit({ ...other, engineId: p.engineId }, "GET", path, "", 2n))).status).toBe(401);
    const q = await seedPairing();
    expect((await call(path, signedInit(q, "GET", path, "", 1n))).status).toBe(401); // q's key on p's session
  });
});
