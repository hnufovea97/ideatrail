import { describe, expect, it } from "vitest";
import { COPY } from "../copy";
import { idea, stage } from "./fixtures";
import { routineCard, stalledDays } from "./routine";

const allStrings = (v: unknown): string[] =>
  typeof v === "string" ? [v] : typeof v === "function" ? [String((v as (a: number, b: number) => string)(7, 3))] : v && typeof v === "object" ? Object.values(v).flatMap(allStrings) : [];

describe("routine check card", () => {
  it("counts filled slots and marks only the first empty one as next", () => {
    const card = routineCard(idea({ filled: ["problem", "audience", "decision_reason"] }), false);
    expect([card.total, card.filled]).toEqual([7, 3]);
    const items = card.groups.flatMap((g) => g.items);
    expect(items.filter((i) => i.next).map((i) => i.slot)).toEqual(["not_doing"]);
    expect(card.groups.map((g) => g.key)).toEqual(["idea", "plan", "run", "feedback"]);
  });
  it("folds 피드백 as 해당 없음: the group leaves the count and is never next", () => {
    const card = routineCard(idea({ filled: ["problem", "audience", "not_doing", "decision_reason", "first_run"] }), true);
    expect([card.total, card.filled, card.feedbackFolded]).toEqual([5, 5, true]);
    expect(card.groups.map((g) => g.key)).toEqual(["idea", "plan", "run"]);
    expect(card.groups.flatMap((g) => g.items).some((i) => i.next)).toBe(false);
  });
  it("shows days in the stage only from 14 days on, never at MVP 완료", () => {
    const now = new Date("2026-11-24T00:00:00Z");
    const stages = [stage(1, { reached: true, firstAt: "2026-10-01T00:00:00Z" }), stage(2, { reached: true, firstAt: "2026-11-01T00:00:00Z" }), stage(3), stage(4), stage(5)];
    expect(stalledDays(idea({ stage: 2, stages }), now)).toBe(23);
    expect(stalledDays(idea({ stage: 2, stages }), new Date("2026-11-10T00:00:00Z"))).toBeNull();
    expect(stalledDays(idea({ stage: 5, stages: stages.map((s) => ({ ...s, reached: true, firstAt: "2026-10-01T00:00:00Z" })) }), now)).toBeNull();
    expect(stalledDays(idea({ stage: 3, stages }), now)).toBeNull(); // stage 3 skipped: no date to count from
  });
  it("is a mirror, not a grade: no score, grade or percent anywhere on the home or idea life (CLAUDE.md rule 8)", () => {
    for (const s of [...allStrings(COPY.home), ...allStrings(COPY.life)]) expect(s).not.toMatch(/점수|등급|%|퍼센트|성적/);
    expect(COPY.life.routine.title(7, 3)).toBe("루틴 점검 7개 중 3개");
  });
});
