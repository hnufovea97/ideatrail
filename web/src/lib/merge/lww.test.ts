import { describe, expect, it } from "vitest";
import type { DeltaRow } from "../sync/rows";
import type { DeltaBody } from "./delta";
import { addSeq, applyDeltas, emptyRootMeta, hasSeq, type Opened } from "./lww";

const E1 = "01jcm3v8q7s2kx4f9d6b5n0ta1";
const E2 = "01jcm3v8q7s2kx4f9d6b5n0ta2";
const R1 = "01jcm3v8q7s2kx4f9d6b5n0tr1";
let n = 0;
function op(engine: string, seq: string, at: string, body: DeltaBody): Opened {
  const row: DeltaRow = { delta_id: `01jcm3v8q7s2kx4f9d6b5n${String(++n).padStart(4, "0")}`, root_id: R1, engine_id: engine, log_seq: seq,
    sealed_delta: "x", engine_sig: "x", created_at: at, merged_at: null, change_seq: n };
  return { row, body };
}
const title = (v: string) => ({ op: "title", recordId: null, value: v }) as const;

describe("per-cell last writer wins (spec §15 M5a)", () => {
  const a = op(E1, "1", "2026-11-11T00:00:00Z", title("A"));
  const b = op(E1, "2", "2026-11-12T00:00:00Z", title("B"));
  const c = op(E2, "1", "2026-11-11T12:00:00Z", { op: "tags", recordId: null, value: ["x"] });

  it("the later signed time wins, and the order of arrival does not matter", () => {
    const results = [[a, b, c], [c, b, a], [b, a, c]].map((order) => applyDeltas(emptyRootMeta(), order, 1));
    for (const r of results) expect(r).toEqual(results[0]);
    expect(results[0].cells.title).toEqual({ value: "B", at: "2026-11-12T00:00:00Z", engine: E1, seq: "2" });
    expect(results[0].merged).toEqual({ [E1]: [["1", "2"]], [E2]: [["1", "1"]] });
  });
  it("two merges equal one merge; a fragment is folded only once", () => {
    const once = applyDeltas(emptyRootMeta(), [a, b, c], 1);
    const twice = applyDeltas(applyDeltas(emptyRootMeta(), [b], 1), [c, a, b], 1);
    expect(twice).toEqual(once);
  });
  it("same time: the higher engine id wins, then the higher seq", () => {
    const t = "2026-11-11T00:00:00Z";
    expect(applyDeltas(emptyRootMeta(), [op(E2, "1", t, title("two")), op(E1, "9", t, title("one"))], 1).cells.title.value).toBe("two");
    expect(applyDeltas(emptyRootMeta(), [op(E1, "3", t, title("3")), op(E1, "10", t, title("10"))], 1).cells.title.value).toBe("10");
  });
  it("routine is one cell per slot; cleared empties only that slot", () => {
    const m = applyDeltas(emptyRootMeta(), [
      op(E1, "1", "2026-11-11T00:00:00Z", { op: "routine", recordId: null, value: [{ slot: "audience", estimated: true, cleared: false }, { slot: "feedback", estimated: false, cleared: false }] }),
      op(E1, "2", "2026-11-12T00:00:00Z", { op: "routine", recordId: null, value: [{ slot: "feedback", estimated: false, cleared: true }] }),
    ], 1);
    expect(m.cells["routine.audience"].value).toEqual({ estimated: true });
    expect(m.cells["routine.feedback"].value).toBeNull();
  });
  it("record_id makes its own cell for milestone only", () => {
    const RID = "01jcm3v8q7s2kx4f9d6b5n0tqy";
    const m = applyDeltas(emptyRootMeta(), [
      op(E1, "1", "2026-11-11T00:00:00Z", { op: "milestone", recordId: RID, value: { milestone: "mvp_done", certain: true } }),
      op(E1, "2", "2026-11-11T00:00:01Z", { op: "title", recordId: RID, value: "root title" }),
    ], 1);
    expect(Object.keys(m.cells).sort()).toEqual([`r.${RID}.milestone`, "title"]);
  });
  it("merged ranges stay compact and answer membership", () => {
    let r = addSeq(undefined, "1");
    r = addSeq(r, "2");
    r = addSeq(r, "4");
    expect(r).toEqual([["1", "2"], ["4", "4"]]);
    r = addSeq(r, "3");
    expect(r).toEqual([["1", "4"]]);
    expect([hasSeq(r, "3"), hasSeq(r, "5"), hasSeq(undefined, "1")]).toEqual([true, false, false]);
  });
  it("never changes the meta it was given", () => {
    const m = emptyRootMeta();
    Object.freeze(m.cells);
    Object.freeze(m.merged);
    Object.freeze(m);
    expect(() => applyDeltas(m, [a], 1)).not.toThrow();
    expect(m.cells).toEqual({});
  });
});
