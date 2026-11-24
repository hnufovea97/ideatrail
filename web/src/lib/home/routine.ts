// Routine check card (설계 §3.1.4, UX ②): a mirror, never a score. Shows filled / empty slots, the one slot to
// fill next (H14), the 피드백 group folded as "해당 없음" per idea, and days in the current stage.
import type { RoutineSlot } from "../model/meta";
import type { IdeaView } from "../model/read-model";
import { daysSince } from "./format";

export type GroupKey = "idea" | "plan" | "run" | "feedback";
export const ROUTINE_GROUPS: readonly { key: GroupKey; slots: readonly RoutineSlot[] }[] = [
  { key: "idea", slots: ["problem"] },
  { key: "plan", slots: ["audience", "not_doing", "decision_reason"] },
  { key: "run", slots: ["first_run"] },
  { key: "feedback", slots: ["feedback", "changed_by_feedback"] },
];
export const STALL_DAYS = 14; // UX ②: "같은 단계에 14일 넘게 머물면"

export interface RoutineItem { slot: RoutineSlot; filled: boolean; estimated: boolean; at: string | null; recordId: string | null; next: boolean }
export interface RoutineGroup { key: GroupKey; items: readonly RoutineItem[] }
export interface RoutineCard { groups: readonly RoutineGroup[]; total: number; filled: number; feedbackFolded: boolean }

export function routineCard(idea: IdeaView, feedbackFolded: boolean): RoutineCard {
  const bySlot = new Map(idea.locked.routine.map((r) => [r.slot, r]));
  const shown = ROUTINE_GROUPS.filter((g) => !(feedbackFolded && g.key === "feedback"));
  const next = shown.flatMap((g) => g.slots).find((slot) => !bySlot.get(slot)?.filled) ?? null;
  const groups = shown.map((g) => ({
    key: g.key,
    items: g.slots.map((slot): RoutineItem => {
      const r = bySlot.get(slot);
      return { slot, filled: r?.filled ?? false, estimated: r?.estimated ?? false, at: r?.at ?? null, recordId: r?.recordId ?? null, next: slot === next };
    }),
  }));
  const items = groups.flatMap((g) => g.items);
  return { groups, total: items.length, filled: items.filter((i) => i.filled).length, feedbackFolded };
}

/** Days in the current stage when it is 14 or more (never for MVP 완료 or a skipped stage); otherwise null. */
export function stalledDays(idea: IdeaView, now: Date): number | null {
  const cur = idea.locked.stages[idea.locked.stage - 1];
  if (idea.locked.stage === 5 || !cur?.firstAt) return null;
  const days = daysSince(cur.firstAt, now);
  return days >= STALL_DAYS ? days : null;
}
