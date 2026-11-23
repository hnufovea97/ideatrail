import { describe, expect, it } from "vitest";
import { newId } from "@ideatrail/crypto/ids";
import { deltaRow, fakeWorld } from "../testing/fake-world";
import { openDelta, parseDelta, UNKNOWN_OP } from "./delta";

const RID = "01jcm3v8q7s2kx4f9d6b5n0tqy";

describe("fragment bodies (kind 4, spec §15 M5a)", () => {
  it("opens what the engine sealed", async () => {
    const w = fakeWorld();
    const row = await deltaRow(w, { rootId: newId(), seq: 1, body: { op: "tags", value: ["기획", "협의"] } });
    expect(await openDelta(w.ak.priv, w.userId, row)).toEqual({ op: "tags", recordId: null, value: ["기획", "협의"] });
  });
  it("a fragment moved to another root does not open", async () => {
    const w = fakeWorld();
    const row = await deltaRow(w, { rootId: newId(), seq: 1, body: { op: "title", value: "x" } });
    expect(await openDelta(w.ak.priv, w.userId, { ...row, root_id: newId() })).toBeNull();
  });
  it("each op has one shape", () => {
    expect(parseDelta({ v: 1, op: "title", value: " 가계부 " })).toEqual({ op: "title", recordId: null, value: "가계부" });
    expect(parseDelta({ v: 1, op: "tags", value: [] })).toEqual({ op: "tags", recordId: null, value: [] });
    expect(parseDelta({ v: 1, op: "routine", value: [{ slot: "audience", estimated: true }, { slot: "feedback", cleared: true }, { slot: "nope" }] }))
      .toEqual({ op: "routine", recordId: null, value: [{ slot: "audience", estimated: true, cleared: false }, { slot: "feedback", estimated: false, cleared: true }] });
    expect(parseDelta({ v: 1, op: "milestone", value: { milestone: "mvp_done", certain: true }, record_id: RID }))
      .toEqual({ op: "milestone", recordId: RID, value: { milestone: "mvp_done", certain: true } });
  });
  it("bad shapes are null; an op this version does not know stays open", () => {
    for (const bad of [{ v: 1, op: "title", value: "" }, { v: 1, op: "tags", value: "a" }, { v: 1, op: "milestone", value: { milestone: "done" } },
      { v: 1, op: "routine", value: [{ slot: "nope" }] }, { v: 1, op: "title", value: "x", record_id: "../x" }, { v: 2, op: "title", value: "x" }]) {
      expect(parseDelta(bad)).toBeNull();
    }
    expect(parseDelta({ v: 1, op: "color", value: "red" })).toBe(UNKNOWN_OP);
  });
});
