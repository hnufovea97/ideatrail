import { describe, expect, it } from "vitest";
import { newId } from "@ideatrail/crypto/ids";
import { openEngineList } from "./engine-list";
import { githubTokenFor, planDisconnect, revokeList, sealRevoked } from "./engines";
import { deltaRow, fakeWorld, linkRow, recordRow, syncOf, worldEngine } from "./testing/fake-world";
import { randomKey } from "@ideatrail/crypto/keypair";
import { memoryStore } from "./engine-list";
import { verifyRows } from "./sync/verify";

const NOW = new Date("2026-11-24T03:00:00Z");

describe("revokeList (5.9a, spec §15 M5a)", () => {
  it("writes version N+1 with the time, the highest accepted seq and the digest; others untouched", async () => {
    const w = fakeWorld();
    const other = worldEngine("Other");
    const list = { ...w.list, engines: [...w.list.engines, other.entry] };
    const root = newId();
    const rows = { records: [await recordRow(w, { rootId: root, seq: 1 })], deltas: [await deltaRow(w, { rootId: root, seq: 2, body: { op: "tags", value: ["a"] } })] };
    const next = revokeList(list, w.engine.id, rows, w.userId, NOW);
    expect(next.version).toBe(list.version + 1);
    const e = next.engines.find((x) => x.engine_id === w.engine.id)!;
    expect(e).toMatchObject({ revoked_at: "2026-11-24T03:00:00Z", revoked_after_seq: "2" });
    expect(e.revoked_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(next.engines.find((x) => x.engine_id === other.id)).toEqual(other.entry);
    expect(list.engines[0].revoked_at).toBeUndefined(); // input not mutated
  });

  it("an engine with no rows gets seq 0", () => {
    const w = fakeWorld();
    const e = revokeList(w.list, w.engine.id, { records: [], deltas: [] }, w.userId, NOW).engines[0];
    expect(e.revoked_after_seq).toBe("0");
    expect(e.revoked_digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the earlier rows still verify against the new list, with no warning", async () => {
    const w = fakeWorld();
    const root = newId();
    const records = [await recordRow(w, { rootId: root, seq: 1 }), await recordRow(w, { rootId: root, seq: 2 })];
    const sync = syncOf({ records });
    const next = revokeList(w.list, w.engine.id, { records, deltas: [] }, w.userId, NOW);
    const v = verifyRows(w.userId, next, sync, memoryStore());
    expect(v.issues).toEqual([]);
    expect(v.records).toHaveLength(2);
  });

  it("the sealed list opens as that version", () => {
    const w = fakeWorld();
    const next = revokeList(w.list, w.engine.id, { records: [], deltas: [] }, w.userId, NOW);
    const blob = sealRevoked(w.mk, w.userId, next);
    expect(openEngineList(w.mk, w.userId, next.version, blob).engines[0].revoked_after_seq).toBe("0");
  });
});

describe("githubTokenFor", () => {
  it("opens that engine's own storage-link token, or null", async () => {
    const w = fakeWorld();
    const link = await linkRow(w);
    expect(await githubTokenFor(w.vault, w.list, [link], w.engine.id)).toBe("fake-token-for-tests");
    expect(await githubTokenFor(w.vault, w.list, [], w.engine.id)).toBeNull();
    expect(await githubTokenFor(w.vault, w.list, [link], newId())).toBeNull();
  });
});

describe("planDisconnect (digest = what a later refresh accepts)", () => {
  const plan = (w: ReturnType<typeof fakeWorld>, sync: ReturnType<typeof syncOf>, marks = memoryStore()) =>
    planDisconnect(w.userId, w.list, sync, marks, w.engine.id, NOW);

  it("freezes a clean engine, and a refresh against the new list reports no mismatch", async () => {
    const w = fakeWorld();
    const root = newId();
    const records = [await recordRow(w, { rootId: root, seq: 1 }), await recordRow(w, { rootId: root, seq: 2 })];
    const sync = syncOf({ records });
    const p = plan(w, sync);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const v = verifyRows(w.userId, p.next, sync, memoryStore(), { now: NOW });
    expect(v.issues).toEqual([]);
    expect(v.records).toHaveLength(2);
  });

  it("refuses a row signed in the future (the later refresh would drop it and mismatch)", async () => {
    const w = fakeWorld();
    const root = newId();
    const sync = syncOf({ records: [await recordRow(w, { rootId: root, seq: 1 }), await recordRow(w, { rootId: root, seq: 2, recordedAt: "2099-01-01T00:00:00Z" })] });
    expect(plan(w, sync).ok).toBe(false);
  });

  it("refuses two rows with one log_seq", async () => {
    const w = fakeWorld();
    const root = newId();
    const sync = syncOf({ records: [await recordRow(w, { rootId: root, seq: 1 }), await recordRow(w, { rootId: root, seq: 1 })] });
    expect(plan(w, sync).ok).toBe(false);
  });

  it("refuses a hole in the log_seqs, a bad signature and an unfinished pull", async () => {
    const w = fakeWorld();
    const root = newId();
    expect(plan(w, syncOf({ records: [await recordRow(w, { rootId: root, seq: 2 })] })).ok).toBe(false);
    const forged = await deltaRow(w, { rootId: root, seq: 1, body: { op: "tags", value: [] }, signer: randomKey() });
    expect(plan(w, syncOf({ deltas: [forged] })).ok).toBe(false);
    expect(plan(w, syncOf({ records: [await recordRow(w, { rootId: root, seq: 1 })] }, false)).ok).toBe(false);
  });

  it("refuses when the highest seq is below what this browser has seen, and writes no mark", async () => {
    const w = fakeWorld();
    const marks = memoryStore();
    marks.set(`it.seq.${w.userId}.${w.engine.id}`, "5");
    const sync = syncOf({ records: [await recordRow(w, { rootId: newId(), seq: 1 })] });
    expect(plan(w, sync, marks).ok).toBe(false);
    expect(marks.get(`it.seq.${w.userId}.${w.engine.id}`)).toBe("5");
    const fresh = memoryStore();
    expect(plan(w, syncOf({ records: [await recordRow(w, { rootId: newId(), seq: 1 })] }), fresh).ok).toBe(true);
    expect(fresh.get(`it.seq.${w.userId}.${w.engine.id}`)).toBeNull(); // read-only
  });

  it("another engine's problem does not block this one", async () => {
    const w = fakeWorld();
    const other = worldEngine("Other");
    const list = { ...w.list, engines: [...w.list.engines, other.entry] };
    const root = newId();
    const sync = syncOf({ records: [await recordRow(w, { rootId: root, seq: 1 }), await recordRow(w, { rootId: root, seq: 3, engine: other })] });
    expect(planDisconnect(w.userId, list, sync, memoryStore(), w.engine.id, NOW).ok).toBe(true);
  });
});
