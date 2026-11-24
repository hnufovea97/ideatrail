import { describe, expect, it } from "vitest";
import { memoryStore } from "../engine-list";
import { feedbackHidden, loadOpened, loadSort, noteOpened, routineShown, saveSort, setFeedbackHidden, setRoutineShown } from "./prefs";

const U = "01jcm3v8q7s2kx4f9d6b5n0tqw";

describe("home prefs (this device only)", () => {
  it("remembers the sort, and falls back to the default on anything odd", () => {
    const s = memoryStore();
    expect(loadSort(s, U)).toBe("firstOld");
    saveSort(s, U, "stage");
    expect(loadSort(s, U)).toBe("stage");
    s.set(`it.home.sort.${U}`, "drop table");
    expect(loadSort(s, U)).toBe("firstOld");
  });
  it("keeps the opening order, newest 200, and survives a hand-edited value", () => {
    const s = memoryStore();
    noteOpened(s, U, "a", 1);
    const m = noteOpened(s, U, "b", 2);
    expect([...m.keys()]).toEqual(["b", "a"]);
    expect(noteOpened(s, U, "a", 3).get("a")).toBe(3);
    for (let i = 0; i < 250; i++) noteOpened(s, U, `x${i}`, 10 + i);
    expect(loadOpened(s, U).size).toBe(200);
    s.set(`it.home.opened.${U}`, "{not json");
    expect(loadOpened(s, U).size).toBe(0);
    s.set(`it.home.opened.${U}`, JSON.stringify({ a: "soon", b: 5 }));
    expect([...loadOpened(s, U)]).toEqual([["b", 5]]);
  });
  it("routine card is on by default and can be turned off and on", () => {
    const s = memoryStore();
    expect(routineShown(s, U)).toBe(true);
    setRoutineShown(s, U, false);
    expect(routineShown(s, U)).toBe(false);
    setRoutineShown(s, U, true);
    expect(routineShown(s, U)).toBe(true);
  });
  it("folds the feedback group per idea", () => {
    const s = memoryStore();
    expect(setFeedbackHidden(s, U, "r1", true).has("r1")).toBe(true);
    expect(feedbackHidden(s, U).has("r1")).toBe(true);
    expect(setFeedbackHidden(s, U, "r1", false).has("r1")).toBe(false);
    s.set(`it.home.nofeedback.${U}`, JSON.stringify([1, "r2"]));
    expect([...feedbackHidden(s, U)]).toEqual(["r2"]);
  });
  it("keys belong to one account: another user on this browser starts fresh", () => {
    const s = memoryStore();
    saveSort(s, U, "last");
    expect(loadSort(s, "01jcm3v8q7s2kx4f9d6b5n0tqx")).toBe("firstOld");
  });
});
