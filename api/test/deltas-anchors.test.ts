import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { toB64u } from "@ideatrail/crypto/bytes";
import { newId } from "@ideatrail/crypto/ids";
import { MAX_OPEN_DELTAS } from "../src/routes/deltas";
import { browser, signUp } from "./browser";
import { engineClient, seedEngine } from "./engine";
import { recordBody, sealed } from "./fixtures";

type Json = Record<string, unknown> & { error?: { code: string } };
const json = async (r: Response) => (await r.json()) as Json;
const one = (sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).first();
const deltaBody = (rootId: string, seq: string) => ({ delta_id: newId(), root_id: rootId, sealed_delta: sealed(4), log_seq: seq, created_at: "2026-11-17T09:00:00Z", engine_sig: toB64u(new Uint8Array(64)) });

async function engineWithRoot() {
  const e = await seedEngine();
  const c = engineClient(e);
  const rec = recordBody({ log_seq: "1" });
  expect((await c.post("/v1/records", rec)).status).toBe(201);
  return { e, c, rootId: rec.root_id as string, recordId: rec.record_id as string };
}

/** A signed-in, confirmed browser plus an engine on the same account. */
async function accountWithEngine() {
  const s = await signUp();
  await s.b.call("POST", "/v1/account/confirm", {});
  const e = await seedEngine({ userId: s.userId });
  return { ...s, e, c: engineClient(e) };
}

describe("POST /v1/deltas (2.8)", () => {
  it("stores a delta for an own root; retries apply once", async () => {
    const { c, rootId } = await engineWithRoot();
    const d = deltaBody(rootId, "2");
    expect((await c.post("/v1/deltas", d)).status).toBe(201);
    expect((await json(await c.post("/v1/deltas", d))).duplicate).toBe(true);
    expect(await one("SELECT COUNT(*) AS n FROM meta_deltas WHERE delta_id = ?", d.delta_id)).toEqual({ n: 1 });
  });
  it("deltas never create roots and cannot touch another account's root", async () => {
    const { c } = await engineWithRoot();
    expect((await c.post("/v1/deltas", deltaBody(newId(), "2"))).status).toBe(404);
    const other = await engineWithRoot();
    expect((await c.post("/v1/deltas", deltaBody(other.rootId, "3"))).status).toBe(404);
  });
  it("caps open deltas per root at 500", async () => {
    const { e, c, rootId } = await engineWithRoot();
    await env.DB.batch(Array.from({ length: MAX_OPEN_DELTAS }, (_, i) =>
      env.DB.prepare("INSERT INTO meta_deltas (delta_id, user_id, root_id, engine_id, seq, sealed_delta, engine_sig, created_at, change_seq) VALUES (?, ?, ?, ?, ?, x'00', 's', 't', 0)")
        .bind(newId(), e.userId, rootId, e.engineId, 1000 + i)));
    const r = await c.post("/v1/deltas", deltaBody(rootId, "2"));
    expect(r.status).toBe(429);
  });
});

describe("anchors, storage link, repo heads, import allowance", () => {
  it("confirmed anchors after a cursor, for engine and browser alike", async () => {
    const { b, c } = await accountWithEngine();
    const rec = recordBody({ log_seq: "1" });
    await c.post("/v1/records", rec);
    await env.DB.prepare("UPDATE anchors SET status = 'confirmed', block_height = 975755, change_seq = 7 WHERE record_id = ?").bind(rec.record_id).run();
    const viaEngine = await json(await c.get("/v1/anchors/confirmed?since=0"));
    expect((viaEngine.anchors as { record_id: string }[]).map((a) => a.record_id)).toEqual([rec.record_id]);
    expect(viaEngine.next_cursor).toBeNull();
    expect(((await json(await b.call("GET", "/v1/anchors/confirmed?since=7"))).anchors as unknown[]).length).toBe(0);
  });

  it("an engine header with a bad signature never falls back to the browser session", async () => {
    const { b } = await accountWithEngine();
    const r = await b.call("GET", "/v1/anchors/confirmed?since=0", undefined, { "x-it-engine": "0".repeat(26) });
    expect(r.status).toBe(401);
  });

  it("synced: local is engine-only; another account's record is 404", async () => {
    const { b, c } = await accountWithEngine();
    const rec = recordBody({ log_seq: "1" });
    await c.post("/v1/records", rec);
    expect((await c.post(`/v1/anchors/${rec.record_id}/synced`, { target: "local" })).status).toBe(200);
    expect((await b.call("POST", `/v1/anchors/${rec.record_id}/synced`, { target: "local" })).status).toBe(403);
    expect((await b.call("POST", `/v1/anchors/${rec.record_id}/synced`, { target: "repo" })).status).toBe(200);
    const other = await engineWithRoot();
    expect((await other.c.post(`/v1/anchors/${rec.record_id}/synced`, { target: "repo" })).status).toBe(404);
  });

  it("storage link: one row per engine, updated in place", async () => {
    const { e, c } = await engineWithRoot();
    const body = () => ({ enc_token: sealed(6, 200), engine_sig: toB64u(new Uint8Array(64)), unix_ts: 1763370000 });
    expect((await c.put("/v1/storage-link", body())).status).toBe(200);
    expect((await c.put("/v1/storage-link", body())).status).toBe(200);
    expect(await one("SELECT COUNT(*) AS n, MAX(created_at) AS t FROM storage_links WHERE engine_id = ?", e.engineId)).toEqual({ n: 1, t: "2025-11-17T09:00:00Z" });
  });

  it("repo heads keep the newest 50 per account", async () => {
    const { e, c } = await engineWithRoot();
    for (let i = 0; i < 52; i++) {
      const r = await c.post("/v1/repo-heads", { commit_sha: i.toString(16).padStart(40, "0"), signature: "sig", reported_at: "2026-11-17T09:00:00Z" });
      expect(r.status).toBe(201);
    }
    expect(await one("SELECT COUNT(*) AS n FROM repo_heads WHERE user_id = ?", e.userId)).toEqual({ n: 50 });
  });

  it("import allowance starts at 200 for 7 days", async () => {
    const { c } = await engineWithRoot();
    const a = await json(await c.get("/v1/import-allowance"));
    expect(a.remaining).toBe(200);
  });

  it("browser writes on dual routes still need the app Origin", async () => {
    const { c } = await accountWithEngine();
    const rec = recordBody({ log_seq: "1" });
    await c.post("/v1/records", rec);
    const evil = browser({ origin: "https://evil.example" });
    expect((await evil.call("POST", `/v1/anchors/${rec.record_id}/synced`, { target: "repo" })).status).toBe(403);
  });
});
