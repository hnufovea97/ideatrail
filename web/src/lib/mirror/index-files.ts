// index/roots.it1 and index/records.it1 (spec §12, §15 M5a): the whole merged list info, relocked with
// subkey(MK,"index_roots" | "index_records"), AAD {user_id}. Rewritten whole after each saved merge.
import { utf8 } from "@ideatrail/crypto/bytes";
import { assertLiveKey, relock } from "@ideatrail/crypto/relock";
import { subkey } from "@ideatrail/crypto/subkey";
import type { RootMetaV1 } from "../merge/lww";
import type { RecordMeta } from "../model/meta";
import type { SyncState } from "../sync/store";
import type { Verified } from "../sync/verify";

export const INDEX_ROOTS = "index/roots.it1";
export const INDEX_RECORDS = "index/records.it1";

function lock(v: { userId: string; mk: Uint8Array }, purpose: "index_roots" | "index_records", body: unknown): Uint8Array {
  assertLiveKey(v.mk); // never relock under a key derived from a wiped master key
  const k = subkey(v.mk, purpose);
  try {
    return relock(k, purpose, { userId: v.userId }, utf8(JSON.stringify(body)));
  } finally {
    k.fill(0);
  }
}

export function indexFiles(v: { userId: string; mk: Uint8Array }, sync: SyncState, verified: Verified,
  metas: ReadonlyMap<string, RootMetaV1>, recordMetas: ReadonlyMap<string, RecordMeta>): Record<string, Uint8Array> {
  const roots = [...sync.roots.values()].map((r) => {
    const meta = metas.get(r.root_id) ?? null;
    return { root_id: r.root_id, visibility: r.visibility, meta_version: meta?.version ?? r.meta_version, meta };
  });
  const records = verified.records.flatMap((r) => {
    const meta = recordMetas.get(r.record_id);
    return meta ? [{ record_id: r.record_id, root_id: r.root_id, engine_id: r.engine_id, log_seq: r.log_seq, recorded_at: r.recorded_at, commitment: r.commitment, meta }] : [];
  });
  return { [INDEX_ROOTS]: lock(v, "index_roots", { v: 1, roots }), [INDEX_RECORDS]: lock(v, "index_records", { v: 1, records }) };
}
