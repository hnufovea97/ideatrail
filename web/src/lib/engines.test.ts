import { describe, expect, it } from "vitest";
import { newId } from "@ideatrail/crypto/ids";
import { openEngineList } from "./engine-list";
import { githubTokenFor, revokeList, sealRevoked } from "./engines";
import { deltaRow, fakeWorld, linkRow, recordRow, syncOf, worldEngine } from "./testing/fake-world";
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
