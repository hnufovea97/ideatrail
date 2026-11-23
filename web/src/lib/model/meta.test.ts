import { describe, expect, it } from "vitest";
import { newId } from "@ideatrail/crypto/ids";
import { newKemKeyPair } from "@ideatrail/crypto/keypair";
import { META, fakeWorld, recordRow } from "../testing/fake-world";
import { openRecordMeta, parseRecordMeta } from "./meta";

describe("record list meta (kind 1)", () => {
  it("opens what the engine sealed, with tags and routine (spec §15 M5a)", async () => {
    const w = fakeWorld();
    const row = await recordRow(w, { rootId: newId(), seq: 1, meta: META({ milestone: "plan_decided", milestone_certain: true, routine: [{ slot: "problem", estimated: true }] }) });
    const m = await openRecordMeta(w.ak.priv, w.userId, row);
    expect(m).toMatchObject({ title: "가계부 앱", milestone: "plan_decided", milestoneCertain: true, tags: ["기획"], routine: [{ slot: "problem", estimated: true }],
      files: [{ path: "docs/plan.md", size: 10, original: true }], decided: null, deferred: null, turn: null, label: null });
  });
  it("is null when sealed to another account key or moved to another record", async () => {
    const w = fakeWorld();
    const other = await recordRow(w, { rootId: newId(), seq: 1, recipient: newKemKeyPair().pub });
    expect(await openRecordMeta(w.ak.priv, w.userId, other)).toBeNull();
    const row = await recordRow(w, { rootId: newId(), seq: 2 });
    expect(await openRecordMeta(w.ak.priv, w.userId, { ...row, record_id: newId() })).toBeNull();
  });
  it("cleans what it shows: hidden characters, too many tags, unknown milestone, odd counts", () => {
    const m = parseRecordMeta(META({ title: "가계부‮앱", tags: ["a", "b", "c", "d", "e", "f", "a"], milestone: "done!", decided: -1, deferred: 2, turn: "카드 연동 빼기", label: "개선 1 · 카드 연동 빼기를 한 줄로 아주 길게",
      routine: [{ slot: "problem" }, { slot: "nope" }, { slot: "problem", estimated: true }] }));
    expect(m!.title).toBe("가계부앱");
    expect(m!.tags).toEqual(["a", "b", "c", "d", "e"]);
    expect(m!.milestone).toBe("none");
    expect([m!.decided, m!.deferred, m!.turn]).toEqual([null, 2, "카드 연동 빼기"]);
    expect(m!.label).toBe("개선 1 · 카드 연동 빼기를 한 줄로 아주 길게".slice(0, 20)); // F1 ①: version name, 20 chars
    expect(m!.routine).toEqual([{ slot: "problem", estimated: false }]);
  });
  it("missing new fields read as empty (records from before M5a)", () => {
    const old: Record<string, unknown> = { ...META() };
    delete old.tags;
    delete old.routine;
    expect(parseRecordMeta(old)).toMatchObject({ tags: [], routine: [] });
    expect(parseRecordMeta({ v: 2 })).toBeNull();
  });
});
