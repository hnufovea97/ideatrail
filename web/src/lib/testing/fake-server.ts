// vitest only — never import from app code. In-memory GET /v1/sync and POST /v1/roots/:id/meta with the rules of
// api/src/routes/sync.ts (rows changed after the cursor) and api/src/routes/roots.ts (save only on the same
// meta_version, and only if every listed fragment is still open). Each request is answered from the state at call time.
import type { Fetch } from "../api";
import type { AnchorRow, DeltaRow, LinkRow, RecordRow, RootRow } from "../sync/rows";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const META_PATH = /^\/v1\/roots\/([0-9a-hjkmnp-tv-z]{26})\/meta$/;
interface Rows { roots?: RootRow[]; records?: RecordRow[]; deltas?: DeltaRow[]; anchors?: AnchorRow[]; links?: LinkRow[] }
interface MetaBody { list_meta: string; meta_version: number; merged_delta_ids: string[] }

export class FakeServer {
  private seq = 0;
  readonly roots = new Map<string, RootRow>();
  readonly records = new Map<string, RecordRow>();
  readonly deltas = new Map<string, DeltaRow>();
  readonly anchors = new Map<string, AnchorRow>();
  readonly links = new Map<string, LinkRow>();
  saves = 0;
  conflicts = 0;
  /** Runs once, inside the first save, before it is judged (e.g. a fragment arriving mid-race). */
  beforeSave: (() => void) | null = null;

  add(rows: Rows): void {
    const stamp = <T extends { change_seq: number }>(r: T): T => ({ ...r, change_seq: ++this.seq });
    for (const r of rows.roots ?? []) this.roots.set(r.root_id, stamp(r));
    for (const r of rows.records ?? []) this.records.set(r.record_id, stamp(r));
    for (const r of rows.deltas ?? []) this.deltas.set(r.delta_id, stamp(r));
    for (const r of rows.anchors ?? []) this.anchors.set(r.record_id, stamp(r));
    for (const r of rows.links ?? []) this.links.set(r.engine_id, stamp(r));
  }

  readonly fetch: Fetch = async (input, init) => {
    const res = this.answer(new URL(input), init?.method ?? "GET", init?.body);
    await Promise.resolve(); // answered now, delivered later: two tabs interleave like real requests
    return res;
  };

  private answer(url: URL, method: string, body: unknown): Response {
    if (method === "GET" && url.pathname === "/v1/sync") return this.sync(Number(url.searchParams.get("cursor") ?? "0"));
    const m = META_PATH.exec(url.pathname);
    if (method === "POST" && m) return this.saveMeta(m[1], JSON.parse(String(body)) as MetaBody);
    return json(404, { error: { code: "not_found" } });
  }

  private sync(cursor: number): Response {
    const after = <T extends { change_seq: number }>(m: Map<string, T>) => [...m.values()].filter((r) => r.change_seq > cursor);
    return json(200, {
      changes: { roots: after(this.roots), records: after(this.records), deltas: after(this.deltas), anchors: after(this.anchors), storage_links: after(this.links) },
      cursor: this.seq, next_cursor: null,
    });
  }

  private saveMeta(rootId: string, b: MetaBody): Response {
    this.saves++;
    const hook = this.beforeSave;
    this.beforeSave = null;
    hook?.();
    const root = this.roots.get(rootId);
    if (!root) return json(404, { error: { code: "root_not_found" } });
    const open = b.merged_delta_ids.every((id) => {
      const d = this.deltas.get(id);
      return !!d && d.root_id === rootId && d.merged_at === null;
    });
    if (root.meta_version !== b.meta_version || !open) {
      this.conflicts++;
      return json(409, { error: { code: "meta_version_conflict" } });
    }
    const seq = ++this.seq;
    this.roots.set(rootId, { ...root, list_meta: b.list_meta, meta_version: root.meta_version + 1, change_seq: seq });
    for (const id of b.merged_delta_ids) this.deltas.set(id, { ...this.deltas.get(id)!, merged_at: "2026-11-23T00:00:00Z", change_seq: seq });
    return json(200, { meta_version: root.meta_version + 1 });
  }
}
