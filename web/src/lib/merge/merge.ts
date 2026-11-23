// 5.3 (spec §3.1.10 E): fold each root's open fragments into its merged meta, relock, and save only if nobody saved
// in between (meta_version). On 409 pull again and fold what is left. Tabs converge because the per-cell order is
// total (lww.ts). Merges only after a finished pull: it needs the latest root rows.
import { ApiFailure, isRetryable, type Api } from "../api";
import type { EngineList, VersionStore } from "../engine-list";
import type { ChainIssue } from "../sync/chain";
import { metaMark, rememberMax } from "../sync/marks";
import { pull } from "../sync/pull";
import type { SyncState } from "../sync/store";
import { verifyRows, type Verified } from "../sync/verify";
import { openDelta, UNKNOWN_OP } from "./delta";
import { applyDeltas, isMerged, type Opened, type RootMetaV1 } from "./lww";
import { openRootMetas, sealRootMeta } from "./root-meta";

export const MERGE_ATTEMPTS = 3;
export interface MergeVault { userId: string; mk: Uint8Array; akPriv: Uint8Array; engineList: EngineList }
export interface Merged {
  sync: SyncState; verified: Verified; metas: ReadonlyMap<string, RootMetaV1>;
  saved: readonly string[]; // roots saved by this tab (the mirror runs only then)
  issues: readonly ChainIssue[];
}

async function openPending(v: MergeVault, verified: Verified, metas: ReadonlyMap<string, RootMetaV1>): Promise<{ byRoot: Map<string, Opened[]>; issues: ChainIssue[] }> {
  const issues: ChainIssue[] = [];
  const byRoot = new Map<string, Opened[]>();
  for (const row of verified.deltas) {
    const meta = metas.get(row.root_id);
    if (!meta || isMerged(meta, row)) continue; // the locked merged ranges decide, not the server's merged_at (G5)
    const body = await openDelta(v.akPriv, v.userId, row);
    if (body === null) {
      issues.push({ kind: "unreadable", table: "deltas", id: row.delta_id });
      continue;
    }
    if (body === UNKNOWN_OP) continue; // a newer dashboard may know it: leave it open
    const list = byRoot.get(row.root_id);
    if (list) list.push({ row, body });
    else byRoot.set(row.root_id, [{ row, body }]);
  }
  return { byRoot, issues };
}

/** One conditional save; null when someone else saved first (409). */
async function saveRoot(api: Api, v: MergeVault, rootId: string, meta: RootMetaV1, items: readonly Opened[]): Promise<RootMetaV1 | null> {
  const next = applyDeltas(meta, items, meta.version + 1);
  try {
    await api.saveRootMeta(rootId, {
      list_meta: sealRootMeta(v.mk, v.userId, rootId, next),
      meta_version: meta.version,
      merged_delta_ids: items.filter((i) => i.row.merged_at === null).map((i) => i.row.delta_id), // roots.ts counts changes() on open ones
    });
    return next;
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 409) return null;
    throw e;
  }
}

/** A root that cannot be saved (too large, refused) is reported and skipped; no answer or a 5xx fails the refresh. */
function rootFailure(rootId: string, e: unknown): ChainIssue {
  if (isRetryable(e)) throw e;
  const tooLarge = (e instanceof Error && e.message === "root_meta_too_large") || (e instanceof ApiFailure && e.status === 413);
  return { kind: tooLarge ? "too_large" : "unreadable", table: "roots", id: rootId };
}

/** `alive` turns false the moment the dashboard locks: nothing is sealed or sent after that (the keys are being wiped). */
export async function mergeAll(api: Api, v: MergeVault, marks: VersionStore, start: SyncState, alive: () => boolean = () => true): Promise<Merged> {
  let sync = start;
  const saved: string[] = [];
  for (let attempt = 1; ; attempt++) {
    const verified = verifyRows(v.userId, v.engineList, sync, marks);
    const roots = openRootMetas(v, sync, marks);
    const metas = new Map(roots.metas);
    const pending = sync.complete ? await openPending(v, verified, metas) : { byRoot: new Map<string, Opened[]>(), issues: [] };
    let conflict = false;
    const issues = [...verified.issues, ...roots.issues, ...pending.issues];
    for (const [rootId, items] of pending.byRoot) {
      if (!alive()) return { sync, verified, metas, saved, issues };
      let next: RootMetaV1 | null;
      try {
        next = await saveRoot(api, v, rootId, metas.get(rootId)!, items);
      } catch (e) {
        if (!alive()) throw e; // locked mid-save (wiped keys): nothing to report
        issues.push(rootFailure(rootId, e));
        continue;
      }
      if (!next) {
        conflict = true;
        continue;
      }
      metas.set(rootId, next);
      saved.push(rootId);
      rememberMax(marks, metaMark(v.userId, rootId), BigInt(next.version));
    }
    // gave up after MERGE_ATTEMPTS conflicts: the fragments stay open and the next refresh tries again
    if (!conflict || attempt >= MERGE_ATTEMPTS || !alive()) return { sync, verified, metas, saved, issues };
    sync = await pull(api, sync); // another tab or device saved first: take its meta and fold only what is left
  }
}
