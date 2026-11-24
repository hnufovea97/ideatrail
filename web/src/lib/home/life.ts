// Idea life (UX ②, ADR-0018): five stage cells with dates, the stage panel (결정 n · 미룸 n summed in that stage,
// 변곡점 for that stage only) and its version rows. Pure: the components only render what this returns.
import { COPY } from "../copy";
import type { IdeaView, StageView, VersionView } from "../model/read-model";
import type { StageNo } from "../model/stage";
import { stageName } from "../model/stage-names";
import { dayRange, monthDay } from "./format";

export type ChainState = "done" | "pending";
export interface VersionRow { recordId: string; when: string; name: string; file: string | null; fingerprint: string; chain: ChainState }
export interface StageRow {
  no: StageNo; name: string; reached: boolean; current: boolean; estimated: boolean;
  date: string | null; range: string | null; decided: number | null; deferred: number | null; turn: string | null;
  versions: readonly VersionRow[];
}
export interface Life { stages: readonly StageRow[]; decided: number | null; deferred: number | null }

const sumOrNull = (xs: readonly (number | null)[]) => (xs.some((x) => x !== null) ? xs.reduce<number>((a, x) => a + (x ?? 0), 0) : null);
export const chainOf = (v: VersionView): ChainState => (v.server.anchor === "server_confirmed" ? "done" : "pending");

/** The version's own name (ADR-0019 label) or "기록 n" for records from before it (n counts from the first). */
function versionRow(v: VersionView, ordinal: number, timeZone?: string): VersionRow {
  return { recordId: v.recordId, when: monthDay(v.server.recordedAt, timeZone), name: v.locked.label ?? COPY.life.recordN(ordinal),
    file: v.locked.mainFile, fingerprint: v.server.fingerprint, chain: chainOf(v) };
}

function stageRow(idea: IdeaView, s: StageView, rows: ReadonlyMap<string, VersionRow>, timeZone?: string): StageRow {
  return {
    no: s.no, name: stageName(s.no, idea.locked.stagePreset), reached: s.reached, current: s.no === idea.locked.stage, estimated: s.estimated,
    date: s.firstAt ? monthDay(s.firstAt, timeZone) : null,
    range: s.firstAt && s.lastAt ? dayRange(s.firstAt, s.lastAt, timeZone) : null,
    decided: s.decided, deferred: s.deferred, turn: s.turn,
    versions: [...s.recordIds].reverse().flatMap((id) => rows.get(id) ?? []), // newest first, like the whole list
  };
}

export function lifeOf(idea: IdeaView, timeZone?: string): Life {
  const count = idea.versions.length;
  const rows = new Map(idea.versions.map((v, i) => [v.recordId, versionRow(v, count - i, timeZone)])); // versions are newest first
  const stages = idea.locked.stages.map((s) => stageRow(idea, s, rows, timeZone));
  return { stages, decided: sumOrNull(stages.map((s) => s.decided)), deferred: sumOrNull(stages.map((s) => s.deferred)) };
}
