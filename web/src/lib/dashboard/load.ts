// One refresh of the open dashboard: pull → verify → merge (5.3) → read model → mirror. No DOM: vitest covers it whole.
import type { Api, Fetch } from "../api";
import type { VersionStore } from "../engine-list";
import { mergeAll, type Merged } from "../merge/merge";
import { commitIndex } from "../mirror/github";
import { indexFiles } from "../mirror/index-files";
import { openRepoAccess } from "../mirror/storage";
import { buildModel, type Built, type IdeaView } from "../model/read-model";
import { chainStatus, type ChainStatus } from "../sync/chain";
import { pull } from "../sync/pull";
import type { SyncState } from "../sync/store";
import type { DashboardVault } from "../unlock";

export interface LoadDeps { api: Api; github: Fetch; marks: VersionStore; now: () => Date }
export type MirrorResult = "none" | "done" | "failed";
export interface Loaded { sync: SyncState; ideas: readonly IdeaView[]; chain: ChainStatus; mirror: MirrorResult }

async function mirror(d: LoadDeps, v: DashboardVault, merged: Merged, built: Built): Promise<MirrorResult> {
  if (merged.saved.length === 0) return "none";
  try {
    const access = await openRepoAccess(v, v.engineList, merged.sync.links.values());
    if (!access) return "none"; // GitHub not connected yet: D1 only (spec §3.1.10 E)
    await commitIndex(d.github, access, indexFiles(v, merged.sync, merged.verified, merged.metas, built.metas));
    return "done";
  } catch {
    return "failed"; // D1 stays the source; the next saved merge rewrites the whole index
  }
}

export async function refresh(d: LoadDeps, v: DashboardVault, prev: SyncState): Promise<Loaded> {
  const merged = await mergeAll(d.api, v, d.marks, await pull(d.api, prev));
  const built = await buildModel(v, merged.sync, merged.verified, merged.metas);
  return {
    sync: merged.sync,
    ideas: built.ideas,
    chain: chainStatus(merged.sync.complete, [...merged.issues, ...built.issues], d.now()),
    mirror: await mirror(d, v, merged, built),
  };
}
