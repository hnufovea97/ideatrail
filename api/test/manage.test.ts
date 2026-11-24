import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { toB64u } from "@ideatrail/crypto/bytes";
import { newId } from "@ideatrail/crypto/ids";
import { browser, signUp } from "./browser";
import { createApp } from "../src/index";
import { engineClient, seedEngine } from "./engine";
import { recordBody, sealed } from "./fixtures";

type Json = Record<string, unknown> & { error?: { code: string } };
const json = async (r: Response) => (await r.json()) as Json;
const one = (sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).first();

const githubCalls: { url: string; auth: string | null; body: string }[] = [];
let githubStatus = 204;
const fakeGithub = async (url: string, init: RequestInit) => {
  githubCalls.push({ url, auth: new Headers(init.headers).get("authorization"), body: String(init.body) });
  return new Response(null, { status: githubStatus });
};

/** Confirmed account with an engine that has one record; browser uses an app wired to fake GitHub. */
async function setup() {
  const app = createApp({ limiter: () => ({ allow: async () => true }), fetcher: fakeGithub, testRoutes: true });
  const s = await signUp();
  await s.b.call("POST", "/v1/account/confirm", {});
  const e = await seedEngine({ userId: s.userId });
  await env.DB.prepare("UPDATE users SET engine_list_version = 1 WHERE user_id = ?").bind(s.userId).run();
  const c = engineClient(e);
  const rec = recordBody({ log_seq: "1" });
  expect((await c.post("/v1/records", rec)).status).toBe(201);
  expect((await c.put("/v1/storage-link", { enc_token: sealed(6), engine_sig: toB64u(new Uint8Array(64)), unix_ts: 1763370000 })).status).toBe(200);
  const call = async (method: string, path: string, body?: unknown) => {
    return app.request(`https://api.test${path}`, { method, headers: { origin: "http://localhost:4321", "content-type": "application/json", cookie: s.b.cookie, "cf-connecting-ip": "203.0.113.7" }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
  };
  const stepup = async (method: string, path: string) => {
    const o = await json(await s.b.call("POST", "/v1/webauthn/stepup/options", { method, path }));
    return { challenge_id: o.challenge_id as string, response: await s.auth.login(o.options as { challenge: string }) };
  };
  return { ...s, e, c, rec, call, stepup };
}

describe("roots meta, visibility, prefs, events (2.9, 2.10)", () => {
  it("merge: meta_version moves by one and listed deltas are marked merged", async () => {
    const s = await setup();
    const d = { delta_id: newId(), root_id: s.rec.root_id, sealed_delta: sealed(4), log_seq: "2", created_at: "2026-11-17T09:00:00Z", engine_sig: toB64u(new Uint8Array(64)) };
    await s.c.post("/v1/deltas", d);
    const path = `/v1/roots/${s.rec.root_id}/meta`;
    expect((await s.call("POST", path, { list_meta: sealed(0x82), meta_version: 0, merged_delta_ids: [d.delta_id] })).status).toBe(200);
    expect(await one("SELECT merged_at IS NOT NULL AS m FROM meta_deltas WHERE delta_id = ?", d.delta_id)).toEqual({ m: 1 });
    expect((await s.call("POST", path, { list_meta: sealed(0x82), meta_version: 0, merged_delta_ids: [] })).status).toBe(409);
    expect((await s.call("POST", path, { list_meta: sealed(0x82), meta_version: 1, merged_delta_ids: [newId()] })).status).toBe(409); // unknown delta id
    expect(await one("SELECT meta_version FROM roots WHERE root_id = ?", s.rec.root_id)).toEqual({ meta_version: 1 });
  });

  it("another account's root is 404", async () => {
    const s = await setup();
    const other = await setup();
    expect((await s.call("POST", `/v1/roots/${other.rec.root_id}/meta`, { list_meta: sealed(0x82), meta_version: 0, merged_delta_ids: [] })).status).toBe(404);
  });

  it("visibility needs step-up", async () => {
    const s = await setup();
    const body = { root_id: s.rec.root_id, visibility: "public", public_label: "My idea" };
    expect((await s.call("POST", "/v1/visibility", body)).status).toBe(401);
    expect((await s.call("POST", "/v1/visibility", { ...body, assertion: await s.stepup("POST", "/v1/visibility") })).status).toBe(200);
    expect(await one("SELECT visibility FROM roots WHERE root_id = ?", s.rec.root_id)).toEqual({ visibility: "public" });
  });

  it("prefs accept only the right relock kinds", async () => {
    const s = await setup();
    expect((await s.call("PUT", "/v1/prefs", { view_prefs: sealed(0x83) })).status).toBe(200);
    expect((await s.call("PUT", "/v1/prefs", { view_prefs: sealed(0x84) })).status).toBe(400);
    expect((await s.call("PUT", "/v1/prefs", {})).status).toBe(400);
  });

  it("events: one per kind per day", async () => {
    const s = await setup();
    await s.call("POST", "/v1/events", { kind: "dashboard_opened" });
    await s.call("POST", "/v1/events", { kind: "dashboard_opened" });
    expect(await one("SELECT COUNT(*) AS n FROM usage_events WHERE user_id = ?", s.userId)).toEqual({ n: 1 });
    expect((await s.call("POST", "/v1/events", { kind: "bogus" })).status).toBe(400);
  });
});

describe("engine revoke / resume, account delete (2.10, 2.13, S6)", () => {
  it("revoke: engine refused afterwards, list version moves, GitHub gets one revocation", async () => {
    const s = await setup();
    githubCalls.length = 0;
    const path = `/v1/engines/${s.e.engineId}/revoke`;
    const r = await s.call("POST", path, { engine_list: sealed(0x88), engine_list_version: 2, github_token: "ghu_secret", assertion: await s.stepup("POST", path) });
    expect(r.status).toBe(200);
    expect((await json(r)).github_revoked).toBe(true);
    expect(githubCalls).toHaveLength(1);
    expect(githubCalls[0].url).toContain("/applications/");
    expect(githubCalls[0].auth).toMatch(/^Basic /);
    expect(JSON.parse(githubCalls[0].body)).toEqual({ access_token: "ghu_secret" });
    expect((await s.c.post("/v1/records", recordBody({ log_seq: "2" }))).status).toBe(401);
    expect(await one("SELECT engine_list_version FROM users WHERE user_id = ?", s.userId)).toEqual({ engine_list_version: 2 });
  });

  it("GitHub failure does not block the disconnect; a second call only retries GitHub", async () => {
    const s = await setup();
    githubStatus = 500;
    const path = `/v1/engines/${s.e.engineId}/revoke`;
    const r1 = await json(await s.call("POST", path, { engine_list: sealed(0x88), engine_list_version: 2, github_token: "t", assertion: await s.stepup("POST", path) }));
    expect(r1).toMatchObject({ revoked: true, github_revoked: false });
    githubStatus = 204;
    const r2 = await json(await s.call("POST", path, { engine_list: sealed(0x88), engine_list_version: 3, github_token: "t", assertion: await s.stepup("POST", path) }));
    expect(r2).toMatchObject({ revoked: true, github_revoked: true });
    expect(await one("SELECT engine_list_version FROM users WHERE user_id = ?", s.userId)).toEqual({ engine_list_version: 2 });
  });

  it("GitHub is not called for an engine that never had a storage link", async () => {
    const s = await setup();
    const bare = await seedEngine({ userId: s.userId });
    githubCalls.length = 0;
    const path = `/v1/engines/${bare.engineId}/revoke`;
    const r = await json(await s.call("POST", path, { engine_list: sealed(0x88), engine_list_version: 2, github_token: "any", assertion: await s.stepup("POST", path) }));
    expect(r.github_revoked).toBeNull();
    expect(githubCalls).toHaveLength(0);
  });

  it("revoke with a stale engine_list_version → 409, nothing changes", async () => {
    const s = await setup();
    const path = `/v1/engines/${s.e.engineId}/revoke`;
    expect((await s.call("POST", path, { engine_list: sealed(0x88), engine_list_version: 1, assertion: await s.stepup("POST", path) })).status).toBe(409);
    expect(await one("SELECT revoked_at FROM engines WHERE engine_id = ?", s.e.engineId)).toEqual({ revoked_at: null });
  });

  it("a revoked engine cannot be resumed (no resurrection); a paused live one can", async () => {
    const s = await setup();
    await env.DB.prepare("UPDATE engines SET paused = 1 WHERE engine_id = ?").bind(s.e.engineId).run();
    expect((await s.call("POST", `/v1/engines/${s.e.engineId}/resume`, {})).status).toBe(401); // step-up required
    const resume = `/v1/engines/${s.e.engineId}/resume`;
    expect((await s.call("POST", resume, { assertion: await s.stepup("POST", resume) })).status).toBe(200);
    const path = `/v1/engines/${s.e.engineId}/revoke`;
    await s.call("POST", path, { engine_list: sealed(0x88), engine_list_version: 2, assertion: await s.stepup("POST", path) });
    expect((await s.call("POST", resume, { assertion: await s.stepup("POST", resume) })).status).toBe(404);
  });

  it("account delete leaves zero rows for that user in every table", async () => {
    const s = await setup();
    await s.c.post("/v1/approvals", { approval_id: newId(), kind: "import", summary: sealed(10), appr_seq: "1", engine_sig: toB64u(new Uint8Array(64)) });
    await s.c.put("/v1/storage-link", { enc_token: sealed(6), engine_sig: toB64u(new Uint8Array(64)), unix_ts: 1763370000 });
    await s.c.post("/v1/repo-heads", { commit_sha: "a".repeat(40), signature: "s", reported_at: "2026-11-17T09:00:00Z" });
    await s.call("POST", "/v1/events", { kind: "signup" });
    const r = await s.call("DELETE", "/v1/account", { assertion: await s.stepup("DELETE", "/v1/account") });
    expect(r.status).toBe(200);
    const tables = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'").all<{ name: string }>()).results.map((t) => t.name);
    for (const t of tables) {
      const cols = (await env.DB.prepare(`PRAGMA table_info(${t})`).all<{ name: string }>()).results.map((c) => c.name);
      if (!cols.includes("user_id")) continue;
      expect(await one(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`, s.userId), t).toEqual({ n: 0 });
    }
    expect((await s.b.call("GET", "/v1/account")).status).toBe(401);
  });
});

describe("user pause, device removal, auto-lock minutes (M5d)", () => {
  it("pause: engine records get 423, no step-up needed; resume needs one; other account 404; revoked 404", async () => {
    const s = await setup();
    const pause = `/v1/engines/${s.e.engineId}/pause`;
    expect((await s.call("POST", pause, {})).status).toBe(200);
    expect(await one("SELECT paused, pause_reason FROM engines WHERE engine_id = ?", s.e.engineId)).toEqual({ paused: 1, pause_reason: "user" });
    expect((await s.c.post("/v1/records", recordBody({ log_seq: "2" }))).status).toBe(423);
    expect(await one("SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ? AND action = 'engine.pause'", s.userId)).toEqual({ n: 1 });
    const resume = `/v1/engines/${s.e.engineId}/resume`;
    expect((await s.call("POST", resume, { assertion: await s.stepup("POST", resume) })).status).toBe(200);
    expect((await s.c.post("/v1/records", recordBody({ log_seq: "2" }))).status).toBe(201);
    const other = await setup();
    expect((await s.call("POST", `/v1/engines/${other.e.engineId}/pause`, {})).status).toBe(404);
    const rev = `/v1/engines/${s.e.engineId}/revoke`;
    await s.call("POST", rev, { engine_list: sealed(0x88), engine_list_version: 2, assertion: await s.stepup("POST", rev) });
    expect((await s.call("POST", pause, {})).status).toBe(404);
  });

  it("remove a device: needs step-up, deletes the row and its envelope, refuses the last one, 404 for others", async () => {
    const s = await setup();
    const creds = (await env.DB.prepare("SELECT credential_id FROM passkey_credentials WHERE user_id = ?").bind(s.userId).all<{ credential_id: string }>()).results;
    expect(creds).toHaveLength(1);
    const only = `/v1/credentials/${creds[0].credential_id}/remove`;
    expect((await s.call("POST", only, {})).status).toBe(401);
    const last = await s.call("POST", only, { assertion: await s.stepup("POST", only) });
    expect(last.status).toBe(409);
    expect((await json(last)).error?.code).toBe("last_device");

    await env.DB.prepare("INSERT INTO passkey_credentials (credential_id, user_id, public_key, sign_count, created_at) VALUES ('second-cred', ?, x'00', 0, '2026-11-01T00:00:00Z')").bind(s.userId).run();
    await env.DB.prepare("INSERT INTO key_envelopes (envelope_id, user_id, method, credential_id, wrapped_master_key, created_at) VALUES ('env-second', ?, 'passkey', 'second-cred', x'00', '2026-11-01T00:00:00Z')").bind(s.userId).run();
    const second = "/v1/credentials/second-cred/remove";
    expect((await s.call("POST", second, { assertion: await s.stepup("POST", second) })).status).toBe(200);
    expect(await one("SELECT COUNT(*) AS n FROM passkey_credentials WHERE user_id = ?", s.userId)).toEqual({ n: 1 });
    expect(await one("SELECT COUNT(*) AS n FROM key_envelopes WHERE envelope_id = 'env-second'")).toEqual({ n: 0 });

    const other = await setup();
    const otherCred = (await one("SELECT credential_id FROM passkey_credentials WHERE user_id = ?", other.userId)) as { credential_id: string };
    const theirs = `/v1/credentials/${otherCred.credential_id}/remove`;
    expect((await s.call("POST", theirs, { assertion: await s.stepup("POST", theirs) })).status).toBe(404);
  });

  it("removing a device ends the account's other sessions; the current one keeps working; a refused removal ends none", async () => {
    const s = await setup();
    const other = browser();
    const o = await json(await other.call("POST", "/v1/webauthn/login/options", {}));
    const login = await other.call("POST", "/v1/webauthn/login/verify", { challenge_id: o.challenge_id, response: await s.auth.login(o.options as { challenge: string }) });
    expect(login.status).toBe(200);
    expect((await other.call("GET", "/v1/account")).status).toBe(200);

    const only = (await one("SELECT credential_id FROM passkey_credentials WHERE user_id = ?", s.userId)) as { credential_id: string };
    const refused = `/v1/credentials/${only.credential_id}/remove`;
    expect((await s.call("POST", refused, { assertion: await s.stepup("POST", refused) })).status).toBe(409);
    expect((await other.call("GET", "/v1/account")).status).toBe(200);

    await env.DB.prepare("INSERT INTO passkey_credentials (credential_id, user_id, public_key, sign_count, created_at) VALUES ('third-cred', ?, x'00', 0, '2026-11-01T00:00:00Z')").bind(s.userId).run();
    const path = "/v1/credentials/third-cred/remove";
    expect((await s.call("POST", path, { assertion: await s.stepup("POST", path) })).status).toBe(200);
    expect((await other.call("GET", "/v1/account")).status).toBe(401);
    expect((await s.call("GET", "/v1/account")).status).toBe(200);
  });

  it("prefs: auto_lock_minutes only 1, 3 or 5; works alone", async () => {
    const s = await setup();
    for (const m of [1, 3, 5]) {
      expect((await s.call("PUT", "/v1/prefs", { auto_lock_minutes: m })).status).toBe(200);
      expect(await one("SELECT auto_lock_minutes AS m FROM users WHERE user_id = ?", s.userId)).toEqual({ m });
    }
    for (const bad of [0, 2, 4, 10, "3", 1.5]) expect((await s.call("PUT", "/v1/prefs", { auto_lock_minutes: bad })).status).toBe(400);
    expect(await one("SELECT auto_lock_minutes AS m FROM users WHERE user_id = ?", s.userId)).toEqual({ m: 5 });
  });
});
