// What this tab has received, in memory only (dropped on lock). Updates always build new maps.
import type { AnchorRow, DeltaRow, EngineRow, LinkRow, Page, RecordRow, RootRow, Table } from "./rows";

export interface SyncState {
  readonly cursor: number;
  readonly complete: boolean; // the last pull reached next_cursor = null
  readonly roots: ReadonlyMap<string, RootRow>;
  readonly records: ReadonlyMap<string, RecordRow>;
  readonly deltas: ReadonlyMap<string, DeltaRow>;
  readonly anchors: ReadonlyMap<string, AnchorRow>;
  readonly engines: ReadonlyMap<string, EngineRow>;
  readonly links: ReadonlyMap<string, LinkRow>;
  readonly bad: readonly Table[];
}

export const emptySync = (): SyncState => ({ cursor: 0, complete: false, roots: new Map(), records: new Map(), deltas: new Map(), anchors: new Map(), engines: new Map(), links: new Map(), bad: [] });

function upsert<T extends { change_seq: number }>(m: ReadonlyMap<string, T>, rows: readonly T[], key: (r: T) => string): ReadonlyMap<string, T> {
  if (rows.length === 0) return m;
  const next = new Map(m);
  for (const r of rows) {
    const old = next.get(key(r));
    if (!old || r.change_seq >= old.change_seq) next.set(key(r), r);
  }
  return next;
}

export function applyPage(s: SyncState, p: Page, cursor: number, complete: boolean): SyncState {
  return {
    cursor: Math.max(s.cursor, cursor),
    complete,
    roots: upsert(s.roots, p.roots, (r) => r.root_id),
    records: upsert(s.records, p.records, (r) => r.record_id),
    deltas: upsert(s.deltas, p.deltas, (r) => r.delta_id),
    anchors: upsert(s.anchors, p.anchors, (r) => r.record_id),
    engines: upsert(s.engines, p.engines, (r) => r.engine_id),
    links: upsert(s.links, p.storage_links, (r) => r.engine_id), // one link per engine (D1 UNIQUE(engine_id))
    bad: [...new Set([...s.bad, ...p.bad])],
  };
}
