// vitest only — IdeaView values shaped exactly like model/read-model.ts builds them.
import type { IdeaView, StageView, VersionView } from "../model/read-model";
import type { StageNo } from "../model/stage";
import { ROUTINE_SLOTS } from "../model/meta";

let n = 0;
const id = () => `01jcm3v8q7s2kx4f9d6b5n${String(++n).padStart(4, "0")}`.slice(0, 26);

export function version(over: { at?: string; label?: string | null; anchor?: "pending" | "server_confirmed"; file?: string | null; recordId?: string } = {}): VersionView {
  return {
    recordId: over.recordId ?? id(), rootId: "r", parentIds: [],
    server: { recordedAt: over.at ?? "2026-11-10T00:00:00Z", commitment: "a3f".padEnd(61, "0") + "9c1", fingerprint: "a3f…9c1", anchor: over.anchor ?? "pending", blockHeight: null, engineId: "e", logSeq: "1", deletedMark: false },
    locked: { title: "가계부 앱", milestone: "none", milestoneCertain: false, files: [], moreFiles: 0, mainFile: over.file === undefined ? "docs/plan.md" : over.file,
      tags: [], routine: [], decided: null, deferred: null, turn: null, label: over.label === undefined ? null : over.label },
  };
}

export function stage(no: StageNo, over: Partial<StageView> = {}): StageView {
  return { no, reached: false, estimated: false, firstAt: null, lastAt: null, recordIds: [], decided: null, deferred: null, turn: null, ...over };
}

export function idea(over: { rootId?: string; title?: string; tags?: string[]; stage?: StageNo; visibility?: "private" | "public"; firstAt?: string; lastAt?: string;
  versions?: VersionView[]; stages?: StageView[]; filled?: string[]; stageNames?: string[] } = {}): IdeaView {
  const versions = over.versions ?? [version()];
  return {
    rootId: over.rootId ?? id(),
    server: { visibility: over.visibility ?? "private", firstAt: over.firstAt ?? "2026-11-03T00:00:00Z", lastAt: over.lastAt ?? "2026-11-18T00:00:00Z", versionCount: versions.length },
    locked: {
      title: over.title ?? "가계부 앱", tags: over.tags ?? [], stagePreset: "build", stageNames: over.stageNames ?? null, stage: over.stage ?? 1, paused: false,
      stages: over.stages ?? ([1, 2, 3, 4, 5] as StageNo[]).map((no) => stage(no)),
      routine: ROUTINE_SLOTS.map((slot) => ({ slot, filled: (over.filled ?? []).includes(slot), estimated: false, recordId: null, at: (over.filled ?? []).includes(slot) ? "2026-11-05T00:00:00Z" : null })),
    },
    versions,
  };
}
