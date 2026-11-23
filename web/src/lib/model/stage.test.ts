import { describe, expect, it } from "vitest";
import type { Milestone } from "./meta";
import { stagesOf, type StagePoint } from "./stage";

let n = 0;
const pt = (milestone: Milestone, certain = false, recordId: string | null = `r${++n}`): StagePoint => ({ recordId, at: `2026-11-10T00:${String(n % 60).padStart(2, "0")}:00Z`, milestone, certain });
const reached = (s: ReturnType<typeof stagesOf>) => s.spans.filter((x) => x.reached).map((x) => x.no);

describe("five stages from milestones (spec §15 M5a)", () => {
  it("no records: stage 1, nothing reached", () => {
    const s = stagesOf([]);
    expect(s.current).toBe(1);
    expect(reached(s)).toEqual([]);
  });
  it("the first record is 착상, certain", () => {
    const first = pt("none");
    const s = stagesOf([first]);
    expect(s.current).toBe(1);
    expect(s.spans[0]).toEqual({ no: 1, reached: true, estimated: false, firstAt: first.at, lastAt: first.at, recordIds: [first.recordId] });
  });
  it("work going on after 착상 is 기획 중 (estimated) and stays there", () => {
    const s = stagesOf([pt("none"), pt("none"), pt("none")]);
    expect(s.current).toBe(2);
    expect(s.spans[1]).toMatchObject({ reached: true, estimated: true });
    expect(s.spans[1].recordIds).toHaveLength(2);
  });
  it("a certain plan_decided is 3 not estimated, then 개발 중, then MVP 완료", () => {
    const s = stagesOf([pt("idea", true), pt("none"), pt("plan_decided", true), pt("none"), pt("mvp_done")]);
    expect(s.current).toBe(5);
    expect(s.spans.map((x) => x.estimated)).toEqual([false, true, false, true, true]);
  });
  it("never goes back down", () => {
    const s = stagesOf([pt("none"), pt("plan_decided", true), pt("idea")]);
    expect(s.current).toBe(4);
  });
  it("a jump marks skipped stages reached with no dates", () => {
    const s = stagesOf([pt("none"), pt("mvp_done", true)]);
    expect(reached(s)).toEqual([1, 2, 3, 4, 5]);
    expect(s.spans[2]).toMatchObject({ reached: true, estimated: true, firstAt: null, recordIds: [] });
  });
  it("a first record that already says plan_decided starts at 3", () => {
    expect(stagesOf([pt("plan_decided", true)]).current).toBe(3);
  });
  it("paused only while the last record is paused", () => {
    expect(stagesOf([pt("none"), pt("paused")]).paused).toBe(true);
    expect(stagesOf([pt("none"), pt("paused"), pt("none")]).paused).toBe(false);
  });
  it("a point without a record (an idea-level milestone) moves the stage but lists no record", () => {
    const s = stagesOf([pt("none"), pt("plan_decided", true, null)]);
    expect(s.current).toBe(3);
    expect(s.spans[2].recordIds).toEqual([]);
    expect(s.spans[2].firstAt).not.toBeNull();
  });
});
