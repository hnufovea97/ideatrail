// What the home remembers on this device only (UX: 고른 정렬은 기기에 기억 · 최근 열어 본 순은 이 기기에만).
// Nothing here goes to the server. Values are read back defensively: storage can be edited or blocked.
import type { VersionStore } from "../engine-list";
import { DEFAULT_SORT, isSortKey, type SortKey } from "./list";

const MAX_OPENED = 200;
const key = (what: string, userId: string) => `it.home.${what}.${userId}`;

function readJson(s: VersionStore, k: string): unknown {
  const raw = s.get(k);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function loadSort(s: VersionStore, userId: string): SortKey {
  const v = s.get(key("sort", userId));
  return isSortKey(v) ? v : DEFAULT_SORT;
}
export const saveSort = (s: VersionStore, userId: string, sort: SortKey): void => s.set(key("sort", userId), sort);

export function loadOpened(s: VersionStore, userId: string): ReadonlyMap<string, number> {
  const v = readJson(s, key("opened", userId));
  if (typeof v !== "object" || v === null || Array.isArray(v)) return new Map();
  return new Map(Object.entries(v).filter((e): e is [string, number] => Number.isSafeInteger(e[1])));
}

/** A new map with `rootId` opened at `at`; only the newest 200 are kept. */
export function noteOpened(s: VersionStore, userId: string, rootId: string, at: number): ReadonlyMap<string, number> {
  const next = [...loadOpened(s, userId)].filter(([id]) => id !== rootId).concat([[rootId, at]])
    .sort((a, b) => b[1] - a[1]).slice(0, MAX_OPENED);
  s.set(key("opened", userId), JSON.stringify(Object.fromEntries(next)));
  return new Map(next);
}

/** Routine check card on (default) or off (설계 §3.1.4). View only — the AI keeps filling the slots either way. */
export const routineShown = (s: VersionStore, userId: string): boolean => s.get(key("routine", userId)) !== "0";
export const setRoutineShown = (s: VersionStore, userId: string, on: boolean): void => s.set(key("routine", userId), on ? "1" : "0");

/** Ideas whose 피드백 group is folded as "해당 없음" (H14 — a view setting, never a record). */
export function feedbackHidden(s: VersionStore, userId: string): ReadonlySet<string> {
  const v = readJson(s, key("nofeedback", userId));
  return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
}

export function setFeedbackHidden(s: VersionStore, userId: string, rootId: string, hidden: boolean): ReadonlySet<string> {
  const rest = [...feedbackHidden(s, userId)].filter((id) => id !== rootId);
  const next = hidden ? [...rest, rootId] : rest;
  s.set(key("nofeedback", userId), JSON.stringify(next));
  return new Set(next);
}
