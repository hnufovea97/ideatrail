// One refresh of the open dashboard: pull → verify → merge (5.3) → read model → mirror. No DOM: vitest covers it whole.
import { ApiFailure, type Api, type Fetch } from "../api";
import type { VersionStore } from "../engine-list";
import { mergeAll, type Merged } from "../merge/merge";
import { commitIndex } from "../mirror/github";
import { indexFiles } from "../mirror/index-files";
import { openRepoAccess } from "../mirror/storage";
import { buildModel, type Built, type IdeaView } from "../model/read-model";
import { chainStatus, type ChainIssue, type ChainStatus } from "../sync/chain";
import { repoMark } from "../sync/marks";
import { pull } from "../sync/pull";
import type { SyncState } from "../sync/store";
import type { DashboardVault } from "../unlock";

/** `alive` is false once the dashboard locked: a refresh in flight then seals, saves and mirrors nothing. */
export interface LoadDeps { api: Api; github: Fetch; marks: VersionStore; now: () => Date; alive: () => boolean }
/** "refused": the storage link points to another repo than the one this browser pinned (sec L2). */
export type MirrorResult = "none" | "done" | "failed" | "refused";
/** `mirrorDirty`: a saved merge is not in index/ yet — pass it to the next refresh, which retries until "done". */
export interface Loaded { sync: SyncState; ideas: readonly IdeaView[]; chain: ChainStatus; mirror: MirrorResult; mirrorDirty: boolean }
export type RefreshFailure = "offline" | "failed";

/** Only "no answer" is offline; any other failure is a plain failure (never shown as a lost connection). */
export const refreshFailure = (e: unknown): RefreshFailure => (e instanceof ApiFailure && e.code === "offline" ? "offline" : "failed");

/** The first repo id this browser mirrored to stays the only one (a swapped storage link cannot redirect the index). */
function repoPinned(d: LoadDeps, userId: string, repoId: number): boolean {
  const key = repoMark(userId);
  const pinned = d.marks.get(key);
  if (pinned === null) {
    d.marks.set(key, String(repoId));
    return true;
  }
  return pinned === String(repoId);
}

async function mirror(d: LoadDeps, v: DashboardVault, merged: Merged, built: Built): Promise<MirrorResult> {
  try {
    const access = await openRepoAccess(v, v.engineList, merged.sync.links.values());
    if (!access || !d.alive()) return "none"; // GitHub not connected yet: D1 only (spec §3.1.10 E)
    if (!repoPinned(d, v.userId, access.repoId)) return "refused";
    await commitIndex(d.github, access, indexFiles(v, merged.sync, merged.verified, merged.metas, built.metas));
    return "done";
  } catch {
    return "failed"; // D1 stays the source; the next refresh rewrites the whole index
  }
}

export async function refresh(d: LoadDeps, v: DashboardVault, prev: SyncState, mirrorDirty = false): Promise<Loaded> {
  const merged = await mergeAll(d.api, v, d.marks, await pull(d.api, prev), d.alive);
  if (!d.alive()) return { sync: merged.sync, ideas: [], chain: { state: "checking" }, mirror: "none", mirrorDirty }; // locked: drop everything
  const built = await buildModel(v, merged.sync, merged.verified, merged.metas);
  const issues: ChainIssue[] = [...merged.issues, ...built.issues];
  const wanted = mirrorDirty || merged.saved.length > 0;
  // Only a clean, finished view is mirrored: a skipped (rolled-back, unreadable) root must never be written to index/.
  const result = wanted && issues.length === 0 && merged.sync.complete && d.alive() ? await mirror(d, v, merged, built) : "none";
  if (result === "refused") issues.push({ kind: "repo_mismatch" });
  return { sync: merged.sync, ideas: built.ideas, chain: chainStatus(merged.sync.complete, issues, d.now()), mirror: result, mirrorDirty: wanted && result !== "done" };
}
