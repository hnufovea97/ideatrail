// The merged root list info (spec §15 M5a root_meta): one cell per field with the stamp of the fragment that set it,
// plus which fragments were folded in (per-engine seq ranges — the server's merged_at is unsigned, G5).
// Cells compare by (signed created_at, engine_id, log_seq): a total order, so any arrival order gives the same result.
import type { DeltaRow } from "../sync/rows";
import type { DeltaBody } from "./delta";

export interface Cell { value: unknown; at: string; engine: string; seq: string }
export type Ranges = readonly (readonly [string, string])[];
export interface RootMetaV1 { v: 1; version: number; cells: Readonly<Record<string, Cell>>; merged: Readonly<Record<string, Ranges>> }
export interface Opened { row: DeltaRow; body: DeltaBody }

export const emptyRootMeta = (): RootMetaV1 => ({ v: 1, version: 0, cells: {}, merged: {} });

type Stamp = Pick<Cell, "at" | "engine" | "seq">;
export function later(a: Stamp, b: Stamp): boolean {
  if (a.at !== b.at) return a.at > b.at; // RFC 3339 UTC seconds: string order = time order
  if (a.engine !== b.engine) return a.engine > b.engine;
  return BigInt(a.seq) > BigInt(b.seq);
}

/** The cells one fragment writes. record_id scopes milestone only; other ops are idea-level. */
export function cellsOf(d: DeltaBody): [string, unknown][] {
  if (d.op === "routine") return d.value.map((r) => [`routine.${r.slot}`, r.cleared ? null : { estimated: r.estimated }]);
  if (d.op === "milestone" && d.recordId) return [[`r.${d.recordId}.milestone`, d.value]];
  return [[d.op, d.value]];
}

export function hasSeq(r: Ranges | undefined, seq: string): boolean {
  const s = BigInt(seq);
  return (r ?? []).some(([a, b]) => BigInt(a) <= s && s <= BigInt(b));
}

export function addSeq(r: Ranges | undefined, seq: string): Ranges {
  const all: [bigint, bigint][] = [...(r ?? []).map(([a, b]): [bigint, bigint] => [BigInt(a), BigInt(b)]), [BigInt(seq), BigInt(seq)]];
  all.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  const out: [bigint, bigint][] = [];
  for (const [a, b] of all) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1n) out[out.length - 1] = [last[0], b > last[1] ? b : last[1]];
    else out.push([a, b]);
  }
  return out.map(([a, b]) => [a.toString(), b.toString()] as const);
}

export const isMerged = (m: RootMetaV1, d: Pick<DeltaRow, "engine_id" | "log_seq">): boolean => hasSeq(m.merged[d.engine_id], d.log_seq);

/** Fold fragments into a new meta (the input is never changed). Already-merged fragments are skipped. */
export function applyDeltas(meta: RootMetaV1, items: readonly Opened[], version: number): RootMetaV1 {
  const cells: Record<string, Cell> = { ...meta.cells };
  const merged: Record<string, Ranges> = { ...meta.merged };
  for (const { row, body } of items) {
    if (hasSeq(merged[row.engine_id], row.log_seq)) continue;
    const stamp: Stamp = { at: row.created_at, engine: row.engine_id, seq: row.log_seq };
    for (const [key, value] of cellsOf(body)) {
      const old = cells[key];
      if (!old || later(stamp, old)) cells[key] = { value, ...stamp };
    }
    merged[row.engine_id] = addSeq(merged[row.engine_id], row.log_seq);
  }
  return { v: 1, version, cells, merged };
}
