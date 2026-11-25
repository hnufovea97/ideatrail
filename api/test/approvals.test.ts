import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toB64u } from "@ideatrail/crypto/bytes";
import { newId } from "@ideatrail/crypto/ids";
import { MAX_INBOX, MAX_PENDING_APPROVALS } from "../src/routes/approvals";
import { signUp } from "./browser";
import { engineClient, seedEngine } from "./engine";
import { sealed } from "./fixtures";

type Json = Record<string, unknown> & { error?: { code: string } };
const json = async (r: Response) => (await r.json()) as Json;
const approval = (seq: string, kind = "import") => ({ approval_id: newId(), kind, summary: sealed(kind === "signup_select" ? 11 : 10), appr_seq: seq, engine_sig: toB64u(new Uint8Array(64)) });
const message = () => ({ msg_id: newId(), sealed: sealed(7) });

async function setup() {
  const s = await signUp();
  await s.b.call("POST", "/v1/account/confirm", {});
  const e = await seedEngine({ userId: s.userId });
  return { ...s, e, c: engineClient(e) };
}

async function stepup(s: Awaited<ReturnType<typeof setup>>, method: string, path: string) {
  const o = await json(await s.b.call("POST", "/v1/webauthn/stepup/options", { method, path }));
  return { challenge_id: o.challenge_id as string, response: await s.auth.login(o.options as { challenge: string }) };
}

describe("approvals (2.9)", () => {
  afterEach(() => vi.useRealTimers());

  it("engine creates → browser lists → decide with step-up → engine inbox gets the answer", async () => {
    const s = await setup();
    const a = approval("1", "signup_select");
    expect((await s.c.post("/v1/approvals", a)).status).toBe(201);
    const list = await json(await s.b.call("GET", "/v1/approvals"));
    expect((list.approvals as { approval_id: string }[]).map((x) => x.approval_id)).toEqual([a.approval_id]);
    const path = `/v1/approvals/${a.approval_id}/decide`;
    const msg = message();
    const r = await s.b.call("POST", path, { decision: "approved", message: msg, assertion: await stepup(s, "POST", path) });
    expect(r.status).toBe(200);
    const inbox = await json(await s.c.get("/v1/inbox"));
    expect((inbox.messages as { msg_id: string }[]).map((m) => m.msg_id)).toEqual([msg.msg_id]);
    expect((await s.c.del(`/v1/inbox/${msg.msg_id}`)).status).toBe(200);
    expect(((await json(await s.c.get("/v1/inbox"))).messages as unknown[]).length).toBe(0);
  });

  it("decide needs step-up", async () => {
    const s = await setup();
    const a = approval("1");
    await s.c.post("/v1/approvals", a);
    expect((await s.b.call("POST", `/v1/approvals/${a.approval_id}/decide`, { decision: "approved", message: message() })).status).toBe(401);
  });

  it("decided or expired approvals cannot be decided again", async () => {
    const s = await setup();
    const a = approval("1");
    await s.c.post("/v1/approvals", a);
    const path = `/v1/approvals/${a.approval_id}/decide`;
    expect((await s.b.call("POST", path, { decision: "rejected", message: message(), assertion: await stepup(s, "POST", path) })).status).toBe(200);
    expect((await s.b.call("POST", path, { decision: "approved", message: message(), assertion: await stepup(s, "POST", path) })).status).toBe(409);
    const b2 = approval("2");
    await s.c.post("/v1/approvals", b2);
    const p2 = `/v1/approvals/${b2.approval_id}/decide`;
    const assertion = await stepup(s, "POST", p2);
    await env.DB.prepare("UPDATE pending_approvals SET expires_at = '2000-01-01T00:00:00Z' WHERE approval_id = ?").bind(b2.approval_id).run();
    expect((await s.b.call("POST", p2, { decision: "approved", message: message(), assertion })).status).toBe(409);
  });

  it("retry with the same appr_seq is applied once; a reused appr_seq for another id → 409", async () => {
    const s = await setup();
    const a = approval("1");
    expect((await s.c.post("/v1/approvals", a)).status).toBe(201);
    expect((await json(await s.c.post("/v1/approvals", a))).duplicate).toBe(true);
    expect((await s.c.post("/v1/approvals", approval("1"))).status).toBe(409);
  });

  it("at most 20 waiting approvals per engine", async () => {
    const s = await setup();
    for (let i = 1; i <= MAX_PENDING_APPROVALS; i++) expect((await s.c.post("/v1/approvals", approval(String(i)))).status).toBe(201);
    expect((await s.c.post("/v1/approvals", approval("99"))).status).toBe(429);
  });

  it("engine can ask for an update approval (kind 10 summary)", async () => {
    const s = await setup();
    expect((await s.c.post("/v1/approvals", approval("1", "update"))).status).toBe(201);
    expect((await s.c.post("/v1/approvals", { ...approval("2", "update"), summary: sealed(11) })).status).toBe(400);
  });

  it("summary kind must match the approval kind", async () => {
    const s = await setup();
    expect((await s.c.post("/v1/approvals", { ...approval("1", "signup_select"), summary: sealed(10) })).status).toBe(400);
  });
});

describe("inbox (2.9)", () => {
  it("browser can only write to its own live engines", async () => {
    const s = await setup();
    const other = await seedEngine();
    expect((await s.b.call("POST", "/v1/inbox", { engine_id: other.engineId, ...message() })).status).toBe(404);
    const revoked = await seedEngine({ userId: s.userId, revoked: true });
    expect((await s.b.call("POST", "/v1/inbox", { engine_id: revoked.engineId, ...message() })).status).toBe(404);
    expect((await s.b.call("POST", "/v1/inbox", { engine_id: s.e.engineId, ...message() })).status).toBe(201);
  });

  it("an engine sees and deletes only its own messages", async () => {
    const s = await setup();
    const m = message();
    await s.b.call("POST", "/v1/inbox", { engine_id: s.e.engineId, ...m });
    const stranger = engineClient(await seedEngine());
    expect(((await json(await stranger.get("/v1/inbox"))).messages as unknown[]).length).toBe(0);
    expect((await stranger.del(`/v1/inbox/${m.msg_id}`)).status).toBe(404);
  });

  it("inbox holds at most 100 messages per engine", async () => {
    const s = await setup();
    await env.DB.batch(Array.from({ length: MAX_INBOX }, () =>
      env.DB.prepare("INSERT INTO engine_inbox (msg_id, user_id, engine_id, sealed, created_at) VALUES (?, ?, ?, x'00', 't')").bind(newId(), s.userId, s.e.engineId)));
    expect((await s.b.call("POST", "/v1/inbox", { engine_id: s.e.engineId, ...message() })).status).toBe(429);
  });
});
