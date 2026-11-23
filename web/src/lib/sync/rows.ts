// Rows of GET /v1/sync (api/src/routes/sync.ts TABLES), checked field by field. The server is not trusted:
// a row that does not have the exact shape is dropped and its table reported, never half-used.
import type { StorageLinkRow } from "../api";

const ID = /^[0-9a-hjkmnp-tv-z]{26}$/;
const SEQ = /^[1-9][0-9]{0,18}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const HEX64 = /^[0-9a-f]{64}$/;
const B64U = /^[A-Za-z0-9_-]+$/;
const PARENTS = /^(-|[0-9a-hjkmnp-tv-z]{26}(,[0-9a-hjkmnp-tv-z]{26}){0,15})$/;

type Check = (v: unknown) => boolean;
const matches = (re: RegExp): Check => (v) => typeof v === "string" && re.test(v);
const id = matches(ID), seq = matches(SEQ), time = matches(TIME), hex64 = matches(HEX64), b64u = matches(B64U);
const orNull = (c: Check): Check => (v) => v === null || c(v);
const count: Check = (v) => Number.isSafeInteger(v) && (v as number) >= 0;
const oneOf = (...xs: string[]): Check => (v) => typeof v === "string" && xs.includes(v);

export interface RootRow { root_id: string; visibility: "private" | "public"; meta_version: number; list_meta: string | null; created_at: string; deleted_at: string | null; change_seq: number }
export interface RecordRow {
  record_id: string; root_id: string; parent_ids: string; commitment: string; recorded_at: string; engine_id: string; log_seq: string;
  engine_sig: string; list_meta: string; body_hash: string; nonce_hash: string; deleted_at: string | null; change_seq: number;
}
export interface DeltaRow { delta_id: string; root_id: string; engine_id: string; log_seq: string; sealed_delta: string; engine_sig: string; created_at: string; merged_at: string | null; change_seq: number }
export interface AnchorRow { record_id: string; status: "pending" | "confirmed"; block_height: number | null; change_seq: number }
export type LinkRow = StorageLinkRow & { change_seq: number };

const SHAPES = {
  roots: { root_id: id, visibility: oneOf("private", "public"), meta_version: count, list_meta: orNull(b64u), created_at: time, deleted_at: orNull(time), change_seq: count },
  records: { record_id: id, root_id: id, parent_ids: matches(PARENTS), commitment: hex64, recorded_at: time, engine_id: id, log_seq: seq, engine_sig: b64u,
    list_meta: b64u, body_hash: hex64, nonce_hash: hex64, deleted_at: orNull(time), change_seq: count },
  deltas: { delta_id: id, root_id: id, engine_id: id, log_seq: seq, sealed_delta: b64u, engine_sig: b64u, created_at: time, merged_at: orNull(time), change_seq: count },
  anchors: { record_id: id, status: oneOf("pending", "confirmed"), block_height: orNull(count), change_seq: count },
  storage_links: { link_id: id, engine_id: id, provider: oneOf("github"), enc_token: orNull(b64u), engine_sig: b64u, created_at: time, revoked_at: orNull(time), change_seq: count },
} as const satisfies Record<string, Record<string, Check>>;

export type Table = keyof typeof SHAPES;
export interface Page { roots: RootRow[]; records: RecordRow[]; deltas: DeltaRow[]; anchors: AnchorRow[]; storage_links: LinkRow[]; bad: Table[] }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function pick<T>(shape: Record<string, Check>, raw: unknown): T | null {
  if (!isObj(raw)) return null;
  const out: Record<string, unknown> = {};
  for (const [k, ok] of Object.entries(shape)) {
    if (!ok(raw[k])) return null;
    out[k] = raw[k];
  }
  return out as T;
}

export function parsePage(changes: Record<string, unknown>): Page {
  const bad: Table[] = [];
  const take = <T>(t: Table): T[] => {
    const list = changes[t];
    if (list === undefined || list === null) return [];
    if (!Array.isArray(list)) return (bad.push(t), []);
    const rows = list.map((raw) => pick<T>(SHAPES[t], raw));
    if (rows.some((r) => r === null)) bad.push(t);
    return rows.filter((r): r is T => r !== null);
  };
  return { roots: take("roots"), records: take("records"), deltas: take("deltas"), anchors: take("anchors"), storage_links: take("storage_links"), bad };
}
