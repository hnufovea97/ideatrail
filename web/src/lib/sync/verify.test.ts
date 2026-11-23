import { describe, expect, it } from "vitest";
import { newId } from "@ideatrail/crypto/ids";
import { randomKey } from "@ideatrail/crypto/keypair";
import { COPY } from "../copy";
import { memoryStore } from "../engine-list";
import { deltaRow, fakeWorld, recordRow, rootRow, syncOf, worldEngine } from "../testing/fake-world";
import { chainLine, chainStatus } from "./chain";
import { seqMark } from "./marks";
import { applyPage } from "./store";
import { verifyRows } from "./verify";

const NOW = new Date(2026, 10, 23, 9, 12);
const tags = { op: "tags", value: ["기획"] };
const lineOf = (complete: boolean, issues: Parameters<typeof chainStatus>[1]) => chainLine(chainStatus(complete, issues, NOW));

describe("sync verification (5.2)", () => {
  it("a clean history is '정상' and keeps every row", async () => {
    const w = fakeWorld();
    const root = newId();
    const s = syncOf({ roots: [rootRow(root)], records: [await recordRow(w, { rootId: root, seq: 1 })], deltas: [await deltaRow(w, { rootId: root, seq: 2, body: tags })] });
    const v = verifyRows(w.userId, w.list, s, memoryStore());
    expect(v.issues).toEqual([]);
    expect(v.records).toHaveLength(1);
    expect(v.deltas).toHaveLength(1);
    expect(lineOf(true, v.issues)).toBe("기록 사슬 정상 · 마지막 확인 9:12");
  });

  it("a forged fragment is dropped and warned — the line never says 정상", async () => {
    const w = fakeWorld();
    const root = newId();
    const forged = await deltaRow(w, { rootId: root, seq: 2, body: tags, signer: randomKey() });
    const s = syncOf({ records: [await recordRow(w, { rootId: root, seq: 1 })], deltas: [forged] });
    const v = verifyRows(w.userId, w.list, s, memoryStore());
    expect(v.deltas).toEqual([]);
    expect(v.issues).toContainEqual({ kind: "bad_signature", table: "deltas", id: forged.delta_id });
    expect(lineOf(true, v.issues)).toBe(COPY.dash.chain.warn);
    expect(lineOf(true, v.issues)).not.toContain("정상");
  });

  it("a fragment from an engine outside the list is refused", async () => {
    const w = fakeWorld();
    const stranger = worldEngine("Other");
    const d = await deltaRow(w, { rootId: newId(), seq: 1, body: tags, engine: stranger });
    const v = verifyRows(w.userId, w.list, syncOf({ deltas: [d] }), memoryStore());
    expect(v.issues).toContainEqual({ kind: "unknown_engine", table: "deltas", id: d.delta_id });
  });

  it("a recorded_at the server changed breaks the record signature", async () => {
    const w = fakeWorld();
    const r = await recordRow(w, { rootId: newId(), seq: 1 });
    const moved = { ...r, recorded_at: "2026-11-01T00:00:00Z" };
    const v = verifyRows(w.userId, w.list, syncOf({ records: [moved] }), memoryStore());
    expect(v.records).toEqual([]);
    expect(v.issues).toContainEqual({ kind: "bad_signature", table: "records", id: r.record_id });
  });

  it("a missing log_seq is a gap and never '정상'; a fragment can fill the gap", async () => {
    const w = fakeWorld();
    const root = newId();
    const one = await recordRow(w, { rootId: root, seq: 1 });
    const three = await recordRow(w, { rootId: root, seq: 3 });
    const gap = verifyRows(w.userId, w.list, syncOf({ records: [one, three] }), memoryStore());
    expect(gap.issues).toEqual([{ kind: "gap", engineId: w.engine.id, missing: ["2"] }]);
    expect(lineOf(true, gap.issues)).not.toContain("정상");
    const filled = verifyRows(w.userId, w.list, syncOf({ records: [one, three], deltas: [await deltaRow(w, { rootId: root, seq: 2, body: tags })] }), memoryStore());
    expect(filled.issues).toEqual([]);
  });

  it("a cut tail is caught by the highest seq this browser saw", async () => {
    const w = fakeWorld();
    const marks = memoryStore();
    marks.set(seqMark(w.userId, w.engine.id), "5");
    const root = newId();
    const s = syncOf({ records: [await recordRow(w, { rootId: root, seq: 1 }), await recordRow(w, { rootId: root, seq: 2 })] });
    expect(verifyRows(w.userId, w.list, s, marks).issues).toEqual([{ kind: "rollback", what: "log_seq", id: w.engine.id }]);
  });

  it("an unfinished pull is '확인 중', never '정상', and teaches the browser nothing", async () => {
    const w = fakeWorld();
    const marks = memoryStore();
    const root = newId();
    const s = syncOf({ records: [await recordRow(w, { rootId: root, seq: 1 }), await recordRow(w, { rootId: root, seq: 3 })] }, false);
    const v = verifyRows(w.userId, w.list, s, marks);
    expect(v.issues).toEqual([]); // a gap may be on a later page: judged only when complete
    expect(lineOf(false, v.issues)).toBe(COPY.dash.chain.checking);
    expect(marks.get(seqMark(w.userId, w.engine.id))).toBeNull();
    verifyRows(w.userId, w.list, { ...s, complete: true }, marks);
    expect(marks.get(seqMark(w.userId, w.engine.id))).toBe("3");
  });

  it("a revoked engine: earlier records still count, later ones are refused", async () => {
    const w = fakeWorld();
    const list = { ...w.list, engines: [{ ...w.engine.entry, revoked_at: "2026-11-10T12:00:00Z" }] };
    const root = newId();
    const before = await recordRow(w, { rootId: root, seq: 1, recordedAt: "2026-11-10T00:00:00Z" });
    const after = await recordRow(w, { rootId: root, seq: 2, recordedAt: "2026-11-11T00:00:00Z" });
    const v = verifyRows(w.userId, list, syncOf({ records: [before, after] }), memoryStore());
    expect(v.records.map((r) => r.record_id)).toEqual([before.record_id]);
    expect(v.issues).toContainEqual({ kind: "unknown_engine", table: "records", id: after.record_id });
  });

  it("malformed rows from the server are reported", async () => {
    const w = fakeWorld();
    const s = applyPage(syncOf({}), { roots: [], records: [], deltas: [], anchors: [], storage_links: [], bad: ["records"] }, 0, true);
    expect(verifyRows(w.userId, w.list, s, memoryStore()).issues).toEqual([{ kind: "bad_row", table: "records" }]);
  });
});
