import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { toB64u } from "@ideatrail/crypto/bytes";
import { newId } from "@ideatrail/crypto/ids";
import { HOURLY_CAP } from "../src/db/quota";
import { inSeconds } from "../src/db/values";
import { seedUser } from "./helpers";
import { engineClient, seedEngine } from "./engine";
import { recordBody } from "./fixtures";

type Json = Record<string, unknown> & { error?: { code: string } };
const json = async (r: Response) => (await r.json()) as Json;
const one = (sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).first();

describe("POST /v1/records (2.8)", () => {
  it("stores record, anchor and root with one change_seq", async () => {
    const e = await seedEngine();
    const body = recordBody({ log_seq: "1" });
    const r = await engineClient(e).post("/v1/records", body);
    expect(r.status).toBe(201);
    const rec = await one("SELECT change_seq, engine_seq, parent_ids FROM records WHERE record_id = ?", body.record_id) as Json;
    const anc = await one("SELECT change_seq, status, next_check_at FROM anchors WHERE record_id = ?", body.record_id) as Json;
    const root = await one("SELECT change_seq, user_id FROM roots WHERE root_id = ?", body.root_id) as Json;
    expect(rec).toMatchObject({ engine_seq: 1, parent_ids: "-" });
    expect(anc.status).toBe("pending");
    expect(rec.change_seq).toBe(anc.change_seq);
    expect(root).toMatchObject({ user_id: e.userId, change_seq: rec.change_seq });
    expect(await one("SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ?", e.userId)).toEqual({ n: 0 }); // record itself is the log
  });

  it("unconfirmed accounts cannot record (S5)", async () => {
    const e = await seedEngine({ userId: await seedUser({ confirmed: false }) });
    expect((await engineClient(e).post("/v1/records", recordBody({ log_seq: "1" }))).status).toBe(403);
  });

  it("a retried upload is applied once", async () => {
    const e = await seedEngine();
    const c = engineClient(e);
    const body = recordBody({ log_seq: "1" });
    expect((await c.post("/v1/records", body)).status).toBe(201);
    const again = await c.post("/v1/records", body);
    expect(again.status).toBe(200);
    expect((await json(again)).duplicate).toBe(true);
    expect(await one("SELECT COUNT(*) AS n FROM records WHERE record_id = ?", body.record_id)).toEqual({ n: 1 });
  });

  it("the same log_seq for a different record → 409; a record id used elsewhere → the same 409", async () => {
    const e = await seedEngine();
    const c = engineClient(e);
    const first = recordBody({ log_seq: "1" });
    await c.post("/v1/records", first);
    const r1 = await c.post("/v1/records", recordBody({ log_seq: "1" }));
    expect(r1.status).toBe(409);
    const other = await seedEngine();
    const r2 = await engineClient(other).post("/v1/records", { ...recordBody({ log_seq: "1" }), record_id: first.record_id });
    expect(r2.status).toBe(409);
    expect((await json(r2)).error!.code).toBe((await json(r1)).error!.code);
  });

  it("another account's root_id cannot be written into (S6)", async () => {
    const victim = await seedEngine();
    const rootId = newId();
    await engineClient(victim).post("/v1/records", recordBody({ log_seq: "1", root_id: rootId }));
    const attacker = await seedEngine();
    const r = await engineClient(attacker).post("/v1/records", recordBody({ log_seq: "1", root_id: rootId }));
    expect(r.status).toBe(409);
    expect(await one("SELECT COUNT(*) AS n FROM records WHERE root_id = ?", rootId)).toEqual({ n: 1 });
  });

  it("hitting the hourly cap pauses the engine (423) and shows in the cursor", async () => {
    const e = await seedEngine();
    const hour = new Date().toISOString().slice(0, 13);
    await env.DB.prepare("UPDATE engines SET hourly_count = ?, hour_bucket = ? WHERE engine_id = ?").bind(HOURLY_CAP, hour, e.engineId).run();
    const r = await engineClient(e).post("/v1/records", recordBody({ log_seq: "1" }));
    expect(r.status).toBe(423);
    expect(await one("SELECT paused, pause_reason FROM engines WHERE engine_id = ?", e.engineId)).toEqual({ paused: 1, pause_reason: "hourly_cap" });
    expect((await one("SELECT change_seq FROM users WHERE user_id = ?", e.userId) as Json).change_seq).toBe(1);
    expect((await engineClient(e, 10n).post("/v1/records", recordBody({ log_seq: "2" }))).status).toBe(423);
  });

  it("import records use the allowance, not the hourly cap; exhausted → 429", async () => {
    const e = await seedEngine();
    await env.DB.prepare("INSERT INTO import_allowances (user_id, remaining, expires_at) VALUES (?, 1, ?)").bind(e.userId, inSeconds(3600)).run();
    const c = engineClient(e);
    expect((await c.post("/v1/records", recordBody({ log_seq: "1", import: true }))).status).toBe(201);
    expect((await c.post("/v1/records", recordBody({ log_seq: "2", import: true }))).status).toBe(429);
    expect(await one("SELECT hourly_count FROM engines WHERE engine_id = ?", e.engineId)).toEqual({ hourly_count: 0 });
  });

  it("rejects receipts for other calendars, non-https, or that do not parse", async () => {
    const e = await seedEngine();
    const c = engineClient(e);
    const bad = [
      { calendar: "http://a.pool.opentimestamps.org", pending: recordBody({ log_seq: "1" }).ots[0].pending },
      { calendar: "https://evil.example", pending: recordBody({ log_seq: "1" }).ots[0].pending },
      { calendar: "https://a.pool.opentimestamps.org", pending: toB64u(Uint8Array.of(0x02)) },
    ];
    for (const [i, ots] of bad.entries()) {
      const r = await c.post("/v1/records", recordBody({ log_seq: String(i + 1), ots: [ots] }));
      expect(r.status, JSON.stringify(ots.calendar)).toBe(400);
    }
  });

  it("rejects a wrong sealed kind, unsorted parents and an oversized list_meta", async () => {
    const c = engineClient(await seedEngine());
    expect((await c.post("/v1/records", recordBody({ log_seq: "1", list_meta: "SVQxAg" }))).status).toBe(400);
    const [a, b] = [newId(), newId()].sort();
    expect((await c.post("/v1/records", recordBody({ log_seq: "2", parent_ids: [b, a] }))).status).toBe(400);
    expect((await c.post("/v1/records", recordBody({ log_seq: "3", list_meta: toB64u(new Uint8Array([0x49, 0x54, 0x31, 1, ...new Uint8Array(9000)])) }))).status).toBe(400);
  });

  it("revoked engines are refused", async () => {
    const e = await seedEngine({ revoked: true });
    expect((await engineClient(e).post("/v1/records", recordBody({ log_seq: "1" }))).status).toBe(401);
  });
});
