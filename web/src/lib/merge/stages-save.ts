// The user renames the five stages (ADR-0020): one conditional root_meta save, merged again and retried on a conflict.
import { ApiFailure, type Api } from "../api";
import type { VersionStore } from "../engine-list";
import { metaMark, rememberMax } from "../sync/marks";
import { pull } from "../sync/pull";
import type { SyncState } from "../sync/store";
import { later, type Cell, type RootMetaV1 } from "./lww";
import { mergeAll, MERGE_ATTEMPTS, type MergeVault } from "./merge";
import { openRootMetas, sealRootMeta } from "./root-meta";
import { parseStageNames, STAGES_CELL } from "./stages";

const isoSeconds = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;

/** The user's cell: stamped now, but never older than the cell it replaces (a slow clock must not lose to its own earlier edit). */
function userCell(names: readonly string[], old: Cell | undefined, now: Date): Cell {
  const fresh: Cell = { value: [...names], at: isoSeconds(now), engine: "-", seq: "1" };
  return old && !later(fresh, old) ? { ...fresh, at: old.at, seq: String(BigInt(old.seq) + 1n) } : fresh;
}

export interface Saved { meta: RootMetaV1; sync: SyncState }

/** Save the user's five names into the root meta (conditional on meta_version). On a conflict: pull, fold what is open, try again. */
export async function saveStageNames(api: Api, v: MergeVault, marks: VersionStore, start: SyncState, rootId: string, names: readonly string[], now: () => Date = () => new Date()): Promise<Saved> {
  if (!parseStageNames(names)) throw new Error("bad_stage_names");
  let sync = start;
  let meta = openRootMetas(v, sync, marks).metas.get(rootId);
  for (let attempt = 1; ; attempt++) {
    if (!meta) throw new Error("root_meta_unavailable");
    const next: RootMetaV1 = { v: 1, version: meta.version + 1, merged: meta.merged, cells: { ...meta.cells, [STAGES_CELL]: userCell(names, meta.cells[STAGES_CELL], now()) } };
    try {
      await api.saveRootMeta(rootId, { list_meta: sealRootMeta(v.mk, v.userId, rootId, next), meta_version: meta.version, merged_delta_ids: [] });
      rememberMax(marks, metaMark(v.userId, rootId), BigInt(next.version));
      return { meta: next, sync };
    } catch (e) {
      if (!(e instanceof ApiFailure && e.status === 409) || attempt >= MERGE_ATTEMPTS) throw e;
    }
    sync = await pull(api, sync); // someone saved first: take its meta, fold the open fragments, then put the names on top
    const merged = await mergeAll(api, v, marks, sync);
    sync = merged.sync;
    meta = merged.metas.get(rootId);
  }
}
