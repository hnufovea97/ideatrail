// The typed read model M5b renders (ADR-0018). `server` = what Ideatrail already holds in plain (dates, fingerprint,
// chain state, visibility) — sharp under the "server's data" switch. `locked` = opened on this device — blurred.
import { emptyRootMeta, type RootMetaV1 } from "../merge/lww";
import { cached, type RowCache } from "../sync/cache";
import type { ChainIssue } from "../sync/chain";
import type { AnchorRow, RecordRow, RootRow } from "../sync/rows";
import type { SyncState } from "../sync/store";
import type { Verified } from "../sync/verify";
import { cleanLabel } from "../text";
import { isMilestone, openRecordMeta, parseTags, ROUTINE_SLOTS, type FileEntry, type Milestone, type RecordMeta, type RoutineMark, type RoutineSlot } from "./meta";
import { stagesOf, type StageNo, type StagePoint, type StageSpan } from "./stage";
import { DEFAULT_STAGE_PRESET, type StagePreset } from "./stage-names";

/** "server_confirmed" is the server's word only; 5.7 checks two explorers before anything says 확정/확산됨. */
export type AnchorView = "pending" | "server_confirmed";

export interface VersionView {
  recordId: string; rootId: string; parentIds: readonly string[];
  server: { recordedAt: string; commitment: string; fingerprint: string; anchor: AnchorView; blockHeight: number | null; engineId: string; logSeq: string; deletedMark: boolean };
  locked: {
    title: string; milestone: Milestone; milestoneCertain: boolean; files: readonly FileEntry[]; moreFiles: number; mainFile: string | null;
    tags: readonly string[]; routine: readonly RoutineMark[]; decided: number | null; deferred: number | null; turn: string | null;
    label: string | null; // version name (F1 ①, ADR-0019) — null until the engine writes it (M5b)
  };
}
export interface StageView extends StageSpan { decided: number | null; deferred: number | null; turn: string | null }
export interface RoutineView { slot: RoutineSlot; filled: boolean; estimated: boolean; recordId: string | null; at: string | null }
export interface IdeaView {
  rootId: string;
  server: { visibility: "private" | "public"; firstAt: string; lastAt: string; versionCount: number };
  locked: { title: string; tags: readonly string[]; stagePreset: StagePreset; stage: StageNo; paused: boolean; stages: readonly StageView[]; routine: readonly RoutineView[] };
  versions: readonly VersionView[]; // newest first
}
export interface Built { ideas: readonly IdeaView[]; metas: ReadonlyMap<string, RecordMeta>; issues: readonly ChainIssue[] }

interface Item { row: RecordRow; meta: RecordMeta }
type MilestoneCell = { milestone?: unknown; certain?: unknown } | null | undefined;

const MAX_TITLE = 80;
export const fingerprint = (commitment: string) => `${commitment.slice(0, 3)}…${commitment.slice(-3)}`;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const cmpSeq = (a: string, b: string) => { const x = BigInt(a), y = BigInt(b); return x < y ? -1 : x > y ? 1 : 0; };
const recordOrder = (a: RecordRow, b: RecordRow) => cmp(a.recorded_at, b.recorded_at) || cmp(a.engine_id, b.engine_id) || cmpSeq(a.log_seq, b.log_seq);
const sumOrNull = (xs: readonly (number | null)[]) => (xs.some((x) => x !== null) ? xs.reduce<number>((a, x) => a + (x ?? 0), 0) : null);
const EMPTY_SLOT = (slot: RoutineSlot): RoutineView => ({ slot, filled: false, estimated: false, recordId: null, at: null });

function withRecordCell(m: RecordMeta, meta: RootMetaV1, recordId: string): RecordMeta {
  const v = meta.cells[`r.${recordId}.milestone`]?.value as MilestoneCell;
  return v && isMilestone(v.milestone) ? { ...m, milestone: v.milestone, milestoneCertain: v.certain === true } : m;
}

function pointsOf(items: readonly Item[], meta: RootMetaV1): StagePoint[] {
  const points: StagePoint[] = items.map(({ row, meta: m }) => ({ recordId: row.record_id, at: row.recorded_at, milestone: m.milestone, certain: m.milestoneCertain }));
  const cell = meta.cells.milestone;
  const v = cell?.value as MilestoneCell;
  if (!cell || !v || !isMilestone(v.milestone)) return points;
  // an idea-level milestone joins the timeline at its own signed time (stable sort keeps record order on ties)
  return [...points, { recordId: null, at: cell.at, milestone: v.milestone, certain: v.certain === true }].sort((a, b) => cmp(a.at, b.at));
}

function stageViews(spans: readonly StageSpan[], metaOf: ReadonlyMap<string, RecordMeta>): StageView[] {
  return spans.map((s) => {
    const ms = s.recordIds.flatMap((id) => metaOf.get(id) ?? []);
    return { ...s, decided: sumOrNull(ms.map((m) => m.decided)), deferred: sumOrNull(ms.map((m) => m.deferred)), turn: [...ms].reverse().find((m) => m.turn !== null)?.turn ?? null };
  });
}

function routineOf(items: readonly Item[], meta: RootMetaV1): RoutineView[] {
  return ROUTINE_SLOTS.map((slot): RoutineView => {
    const cell = meta.cells[`routine.${slot}`];
    if (cell) {
      const v = cell.value as { estimated?: unknown } | null;
      return v === null ? EMPTY_SLOT(slot) : { slot, filled: true, estimated: v.estimated === true, recordId: null, at: cell.at };
    }
    for (const { row, meta: m } of items) {
      const mark = m.routine.find((r) => r.slot === slot);
      if (mark) return { slot, filled: true, estimated: mark.estimated, recordId: row.record_id, at: row.recorded_at }; // first evidence
    }
    return EMPTY_SLOT(slot);
  });
}

function versionOf(row: RecordRow, m: RecordMeta, anchor: AnchorRow | undefined): VersionView {
  return {
    recordId: row.record_id, rootId: row.root_id, parentIds: row.parent_ids === "-" ? [] : row.parent_ids.split(","),
    server: {
      recordedAt: row.recorded_at, commitment: row.commitment, fingerprint: fingerprint(row.commitment),
      anchor: anchor?.status === "confirmed" ? "server_confirmed" : "pending", blockHeight: anchor?.block_height ?? null,
      engineId: row.engine_id, logSeq: row.log_seq, deletedMark: row.deleted_at !== null,
    },
    locked: {
      title: m.title, milestone: m.milestone, milestoneCertain: m.milestoneCertain, files: m.files, moreFiles: m.moreFiles, mainFile: m.files[0]?.path ?? null,
      tags: m.tags, routine: m.routine, decided: m.decided, deferred: m.deferred, turn: m.turn, label: m.label,
    },
  };
}

function ideaOf(rootId: string, root: RootRow | undefined, found: readonly Item[], meta: RootMetaV1, anchors: ReadonlyMap<string, AnchorRow>): IdeaView {
  const items = [...found].sort((a, b) => recordOrder(a.row, b.row)).map(({ row, meta: m }) => ({ row, meta: withRecordCell(m, meta, row.record_id) }));
  const stages = stagesOf(pointsOf(items, meta));
  const metaOf = new Map(items.map((x) => [x.row.record_id, x.meta]));
  const latest = items[items.length - 1];
  const cellTitle = meta.cells.title?.value;
  return {
    rootId,
    server: { visibility: root?.visibility ?? "private", firstAt: items[0].row.recorded_at, lastAt: latest.row.recorded_at, versionCount: items.length },
    locked: {
      title: (typeof cellTitle === "string" ? cleanLabel(cellTitle, MAX_TITLE) : "") || latest.meta.title,
      tags: parseTags(meta.cells.tags?.value) ?? items.find((x) => x.meta.tags.length > 0)?.meta.tags ?? [],
      stagePreset: DEFAULT_STAGE_PRESET, // per-idea presets later (founder 2026-11-24); always "build" in M5b
      stage: stages.current, paused: stages.paused, stages: stageViews(stages.spans, metaOf), routine: routineOf(items, meta),
    },
    versions: [...items].reverse().map(({ row, meta: m }) => versionOf(row, m, anchors.get(row.record_id))),
  };
}

/** Open every verified record's list meta and group by idea. Roots come from the records (a missing root row hides nothing). */
export async function buildModel(v: { userId: string; akPriv: Uint8Array }, sync: SyncState, verified: Verified, rootMetas: ReadonlyMap<string, RootMetaV1>, cache?: RowCache): Promise<Built> {
  const opened = await Promise.all(verified.records.map(async (row) => ({ row, meta: await cached(cache, "record", row.record_id, row, () => openRecordMeta(v.akPriv, v.userId, row)) })));
  const issues: ChainIssue[] = [];
  const metas = new Map<string, RecordMeta>();
  const byRoot = new Map<string, Item[]>();
  for (const { row, meta } of opened) {
    if (!meta) {
      issues.push({ kind: "unreadable", table: "records", id: row.record_id });
      continue;
    }
    metas.set(row.record_id, meta);
    const list = byRoot.get(row.root_id);
    if (list) list.push({ row, meta });
    else byRoot.set(row.root_id, [{ row, meta }]);
  }
  const ideas = [...byRoot]
    .map(([rootId, items]) => ideaOf(rootId, sync.roots.get(rootId), items, rootMetas.get(rootId) ?? emptyRootMeta(), sync.anchors))
    .sort((a, b) => cmp(a.server.firstAt, b.server.firstAt) || cmp(a.rootId, b.rootId)); // UX default: 처음 기록한 순
  return { ideas, metas, issues };
}
