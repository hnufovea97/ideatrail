// Home list (ADR-0018, UX ① 정렬): tabs, #tag + stage search and the five sorts — all on this device, after unlock.
import type { IdeaView } from "../model/read-model";
import { chainOf, type ChainState } from "./life";
import { stageNameOf } from "../model/stage-names";

export const TABS = ["all", "shared", "mine"] as const;
export type Tab = (typeof TABS)[number];
export const SORT_KEYS = ["firstOld", "firstNew", "last", "stage", "opened"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const DEFAULT_SORT: SortKey = "firstOld"; // founder 2026-11-21: 처음 기록한 순, 오래된 것부터
export const isSortKey = (v: unknown): v is SortKey => (SORT_KEYS as readonly unknown[]).includes(v);

export interface ListQuery { tab: Tab; query: string; sort: SortKey; opened: ReadonlyMap<string, number> }

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();

export function inTab(idea: IdeaView, tab: Tab): boolean {
  if (tab === "all") return true;
  return tab === "shared" ? idea.server.visibility === "public" : idea.server.visibility === "private";
}

/** "#기획 MVP 완료": every word must match — `#x` a tag that starts with x, anything else the name or stage name. */
export function matchesQuery(idea: IdeaView, query: string): boolean {
  const words = query.trim().split(/\s+/).filter((w) => w.length > 0);
  const tags = idea.locked.tags.map((t) => t.toLowerCase());
  const text = squash(idea.locked.title + stageNameOf(idea, idea.locked.stage));
  return words.every((w) => (w.startsWith("#") && w.length > 1 ? tags.some((t) => t.startsWith(w.slice(1).toLowerCase())) : text.includes(squash(w))));
}

type Compare = (a: IdeaView, b: IdeaView) => number;
const byFirst: Compare = (a, b) => cmp(a.server.firstAt, b.server.firstAt) || cmp(a.rootId, b.rootId);
const byLastNewest: Compare = (a, b) => cmp(b.server.lastAt, a.server.lastAt) || cmp(a.rootId, b.rootId);

function comparator(sort: SortKey, opened: ReadonlyMap<string, number>): Compare {
  switch (sort) {
    case "firstOld": return byFirst;
    case "firstNew": return (a, b) => byFirst(b, a);
    case "last": return byLastNewest;
    case "stage": return (a, b) => b.locked.stage - a.locked.stage || byLastNewest(a, b);
    case "opened": return (a, b) => (opened.get(b.rootId) ?? 0) - (opened.get(a.rootId) ?? 0) || byLastNewest(a, b);
  }
}

/** The cards to show, in order. Never changes `ideas`. */
export function listIdeas(ideas: readonly IdeaView[], q: ListQuery): IdeaView[] {
  return ideas.filter((i) => inTab(i, q.tab) && matchesQuery(i, q.query)).sort(comparator(q.sort, q.opened));
}

/** The card badge: "done" only when the browser checked every version's block (5.7); the worst state wins otherwise. */
export function ideaChain(idea: IdeaView): ChainState {
  const states = idea.versions.map(chainOf);
  if (states.length > 0 && states.every((s) => s === "done")) return "done";
  for (const worst of ["mismatch", "invalid", "pending", "checking"] as const) if (states.includes(worst)) return worst;
  return "pending";
}
