// Five stages (UX: 착상 → 기획 중 → 기획 확정 → 개발 중 → MVP 완료) from milestones (spec §15 M5a, G9).
// Points come in time order. A stage only goes up. "estimated" = the point that entered it was not certain.
import type { Milestone } from "./meta";

export type StageNo = 1 | 2 | 3 | 4 | 5;
export const STAGE_NUMBERS: readonly StageNo[] = [1, 2, 3, 4, 5];
export interface StagePoint { recordId: string | null; at: string; milestone: Milestone; certain: boolean }
export interface StageSpan { no: StageNo; reached: boolean; estimated: boolean; firstAt: string | null; lastAt: string | null; recordIds: readonly string[] }
export interface Stages { current: StageNo; paused: boolean; spans: readonly StageSpan[] }

const TARGET: Partial<Record<Milestone, StageNo>> = { idea: 1, plan_decided: 3, feature_done: 4, mvp_done: 5 };
const WORK_GOES_ON: Partial<Record<StageNo, StageNo>> = { 1: 2, 3: 4 }; // a plain record after 착상 / 기획 확정
interface Step { no: StageNo; entered: boolean; estimated: boolean }

function jump(cur: StageNo, p: StagePoint): Step | null {
  const target = TARGET[p.milestone];
  return target !== undefined && target > cur ? { no: target, entered: true, estimated: !p.certain } : null;
}

function step(cur: StageNo, p: StagePoint, first: boolean): Step {
  const j = jump(cur, p);
  if (j) return j;
  if (first) return { no: 1, entered: true, estimated: false }; // 💡 first record: automatic and certain (§3.1.2)
  const next = WORK_GOES_ON[cur];
  return next !== undefined && p.milestone !== "paused" ? { no: next, entered: true, estimated: true } : { no: cur, entered: false, estimated: false };
}

export function stagesOf(points: readonly StagePoint[]): Stages {
  let cur: StageNo = 1;
  const placed = points.map((p, i) => {
    const s = step(cur, p, i === 0);
    cur = s.no;
    return { p, ...s };
  });
  const spans = STAGE_NUMBERS.map((no): StageSpan => {
    const mine = placed.filter((x) => x.no === no);
    const enter = mine.find((x) => x.entered);
    const reached = points.length > 0 && no <= cur;
    return {
      no, reached,
      estimated: reached && (enter ? enter.estimated : true), // a skipped stage was never seen: estimated
      firstAt: mine[0]?.p.at ?? null,
      lastAt: mine[mine.length - 1]?.p.at ?? null,
      recordIds: mine.flatMap((x) => (x.p.recordId ? [x.p.recordId] : [])),
    };
  });
  return { current: cur, paused: points[points.length - 1]?.milestone === "paused", spans };
}
