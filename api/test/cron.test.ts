import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fromHex, toB64u } from "@ideatrail/crypto/bytes";
import fx from "../../spec/vectors/ots/receipts.json";
import { parseTimestamp, serializeTimestamp } from "../src/ots/tree";
import { newId } from "@ideatrail/crypto/ids";
import { FETCH_BUDGET, nextInterval, runCron } from "../src/cron";
import { inSeconds, isoAt } from "../src/db/values";
import { seedUser } from "./helpers";
import { engineClient, seedEngine } from "./engine";
import { aliceUpgrade, recordBody } from "./fixtures";

const one = (sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).first();
const ALICE = "https://alice.btc.calendar.opentimestamps.org/timestamp/";

/** Fake calendars: alice answers with the real upgrade; everything else (incl. the pool) is 404. */
function calendars() {
  const calls: string[] = [];
  const up = aliceUpgrade();
  const fetcher = async (url: string) => {
    calls.push(url);
    if (url === ALICE + up.msgHex) return new Response(up.bytes, { status: 200 });
    return new Response("Not found", { status: 404 });
  };
  return { calls, fetcher };
}

async function dueRecord() {
  const e = await seedEngine();
  const rec = recordBody({ log_seq: "1" });
  await engineClient(e).post("/v1/records", rec);
  await env.DB.prepare("UPDATE anchors SET next_check_at = ? WHERE record_id = ?").bind(inSeconds(-1), rec.record_id).run();
  return { e, rec };
}

describe("Cron: Bitcoin confirmations (2.11, S7, S8)", () => {
  afterEach(() => vi.useRealTimers());

  it("asks the calendar named INSIDE the receipt (alice), not the pool, and confirms block 975755", async () => {
    const { e, rec } = await dueRecord();
    const cal = calendars();
    const before = (await one("SELECT change_seq FROM users WHERE user_id = ?", e.userId) as { change_seq: number }).change_seq;
    const report = await runCron(env, cal.fetcher);
    expect(cal.calls.every((u) => u.startsWith(ALICE))).toBe(true);
    expect(report.confirmed).toBeGreaterThanOrEqual(1);
    const a = await one("SELECT status, block_height, complete_receipt IS NOT NULL AS has, change_seq FROM anchors WHERE record_id = ?", rec.record_id) as Record<string, number | string>;
    expect(a).toMatchObject({ status: "confirmed", block_height: 975755, has: 1 });
    expect(a.change_seq).toBe(before + 1);
  });

  it("failures back off: 30 min → 60 → 120…, capped at 24h", async () => {
    expect([0, 1, 2, 10].map(nextInterval)).toEqual([1800, 3600, 7200, 86400]);
    const { rec } = await dueRecord();
    const t0 = Date.now();
    await runCron(env, async () => new Response(null, { status: 404 }));
    const a = await one("SELECT status, next_check_at, calendars FROM anchors WHERE record_id = ?", rec.record_id) as { status: string; next_check_at: string; calendars: string };
    expect(a.status).toBe("pending");
    expect(JSON.parse(a.calendars)[0].attempts).toBe(1);
    const waited = (Date.parse(a.next_check_at) - t0) / 1000;
    expect(waited).toBeGreaterThan(3500);
    expect(waited).toBeLessThan(3700);
  });

  it("never contacts a host outside the allowlist", async () => {
    const userId = await seedUser();
    const e = await seedEngine({ userId });
    const rec = recordBody({ log_seq: "1" });
    await engineClient(e).post("/v1/records", rec);
    // a receipt whose pending point names an attacker host (bypassing ingest checks)
    const evil = serializeTimestamp({ msg: fromHex(fx.digest_hex), attestations: [{ kind: "pending", uri: "https://evil.example" }], ops: [] });
    expect(parseTimestamp(evil, fromHex(fx.digest_hex)).attestations).toHaveLength(1); // well-formed: only the allowlist stops it
    await env.DB.prepare("UPDATE anchors SET calendars = ?, next_check_at = ? WHERE record_id = ?")
      .bind(JSON.stringify([{ calendar: "https://evil.example", pending: toB64u(evil), attempts: 0 }]), inSeconds(-1), rec.record_id).run();
    const cal = calendars();
    await runCron(env, cal.fetcher);
    expect(cal.calls.some((u) => u.includes("evil"))).toBe(false);
  });

  it(`stays within ${FETCH_BUDGET} outbound requests per run (S8)`, async () => {
    const e = await seedEngine();
    const c = engineClient(e);
    await env.DB.prepare("UPDATE engines SET hourly_count = 0 WHERE engine_id = ?").bind(e.engineId).run();
    for (let i = 1; i <= 60; i++) await c.post("/v1/records", recordBody({ log_seq: String(i) }));
    await env.DB.prepare("UPDATE anchors SET next_check_at = ? WHERE user_id = ?").bind(inSeconds(-1), e.userId).run();
    let fetches = 0;
    const report = await runCron(env, async () => { fetches++; return new Response(null, { status: 404 }); });
    expect(fetches).toBeLessThanOrEqual(FETCH_BUDGET);
    expect(report.fetches).toBe(fetches);
  });
});

describe("Cron: cleanup", () => {
  it("removes expired sessions/challenges and abandoned unconfirmed accounts", async () => {
    const stale = await seedUser({ confirmed: false });
    await env.DB.prepare("UPDATE users SET created_at = ? WHERE user_id = ?").bind(isoAt(Date.now() - 2 * 86400_000), stale).run();
    const live = await seedUser();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO sessions VALUES (?, ?, 't', ?)").bind(newId(), live, isoAt(Date.now() - 1000)),
      env.DB.prepare("INSERT INTO webauthn_challenges (challenge_id, challenge, purpose, created_at, expires_at) VALUES (?, 'c', 'login', 't', ?)").bind(newId(), isoAt(Date.now() - 2 * 86400_000)),
    ]);
    await runCron(env, async () => new Response(null, { status: 404 }));
    expect(await one("SELECT COUNT(*) AS n FROM users WHERE user_id = ?", stale)).toEqual({ n: 0 });
    expect(await one("SELECT COUNT(*) AS n FROM users WHERE user_id = ?", live)).toEqual({ n: 1 });
    expect(await one("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", live)).toEqual({ n: 0 });
  });
});
