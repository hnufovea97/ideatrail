// kind 1 record_meta (spec §15): opened with the account key, then cleaned — every string comes from outside.
import { fromB64u } from "@ideatrail/crypto/bytes";
import { KIND, open } from "@ideatrail/crypto/seal";
import type { RecordRow } from "../sync/rows";
import { cleanLabel } from "../text";

export const MILESTONES = ["none", "idea", "plan_decided", "mvp_done", "feature_done", "paused"] as const;
export type Milestone = (typeof MILESTONES)[number];
export const ROUTINE_SLOTS = ["problem", "audience", "not_doing", "decision_reason", "first_run", "feedback", "changed_by_feedback"] as const;
export type RoutineSlot = (typeof ROUTINE_SLOTS)[number];
export interface RoutineMark { slot: RoutineSlot; estimated: boolean }
export interface FileEntry { path: string; size: number; original: boolean }
export interface RecordMeta {
  title: string; milestone: Milestone; milestoneCertain: boolean; files: readonly FileEntry[]; moreFiles: number;
  tags: readonly string[]; routine: readonly RoutineMark[];
  decided: number | null; deferred: number | null; turn: string | null; label: string | null; // optional kind 1 fields (G10 / F1 ①, ADR-0019)
}

const MAX = { title: 80, tag: 20, tags: 5, files: 20, path: 512, turn: 40, label: 20, count: 999 } as const;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const isMilestone = (v: unknown): v is Milestone => (MILESTONES as readonly unknown[]).includes(v);
export const isSlot = (v: unknown): v is RoutineSlot => (ROUTINE_SLOTS as readonly unknown[]).includes(v);
const text = (v: unknown, max: number) => (typeof v === "string" ? cleanLabel(v, max) : "");
const smallCount = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX.count ? (v as number) : null);

/** Tags: cleaned, unique, at most 5. null when not a list (callers fall back). */
export function parseTags(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return [...new Set(v.map((t) => text(t, MAX.tag)).filter((t) => t.length > 0))].slice(0, MAX.tags);
}

/** Routine marks: known slots only, first one per slot wins. */
export function parseRoutine(v: unknown): RoutineMark[] {
  if (!Array.isArray(v)) return [];
  const out: RoutineMark[] = [];
  for (const r of v) if (isObj(r) && isSlot(r.slot) && !out.some((x) => x.slot === r.slot)) out.push({ slot: r.slot, estimated: r.estimated === true });
  return out;
}

function parseFiles(v: unknown): FileEntry[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((f): FileEntry[] => (isObj(f) && typeof f.path === "string" && Number.isSafeInteger(f.size) && (f.size as number) >= 0
    ? [{ path: cleanLabel(f.path, MAX.path), size: f.size as number, original: f.original === true }] : [])).slice(0, MAX.files);
}

export function parseRecordMeta(raw: unknown): RecordMeta | null {
  if (!isObj(raw) || raw.v !== 1) return null;
  const turn = text(raw.turn, MAX.turn);
  const label = text(raw.label, MAX.label);
  return {
    title: text(raw.title, MAX.title),
    milestone: isMilestone(raw.milestone) ? raw.milestone : "none",
    milestoneCertain: raw.milestone_certain === true,
    files: parseFiles(raw.files),
    moreFiles: smallCount(raw.more_files) ?? 0,
    tags: parseTags(raw.tags) ?? [],
    routine: parseRoutine(raw.routine),
    decided: smallCount(raw.decided),
    deferred: smallCount(raw.deferred),
    turn: turn.length > 0 ? turn : null,
    label: label.length > 0 ? label : null,
  };
}

/** null for anything that does not open or parse (wrong key, moved blob, bad JSON): one answer, no oracle. */
export async function openRecordMeta(akPriv: Uint8Array, userId: string, row: RecordRow): Promise<RecordMeta | null> {
  try {
    const pt = await open(KIND.record_meta, akPriv, { userId, rootId: row.root_id, recordId: row.record_id, version: "0" }, fromB64u(row.list_meta));
    return parseRecordMeta(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(pt)));
  } catch {
    return null;
  }
}
