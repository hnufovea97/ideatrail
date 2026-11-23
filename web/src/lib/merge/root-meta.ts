// root_meta relock (spec §15 M5a): subkey(MK,"root_meta"), AAD {user_id, root_id, version: meta_version after the save}.
// The version in the AAD and in the plaintext must both equal the row's meta_version — the server cannot pair an old
// blob with a new number; a whole old row is caught by the it.mv mark.
import { fromB64u, toB64u, utf8 } from "@ideatrail/crypto/bytes";
import { relock, unlock } from "@ideatrail/crypto/relock";
import { subkey } from "@ideatrail/crypto/subkey";
import type { VersionStore } from "../engine-list";
import type { ChainIssue } from "../sync/chain";
import { metaMark, rememberMax, seenMax } from "../sync/marks";
import type { RootRow } from "../sync/rows";
import type { SyncState } from "../sync/store";
import { emptyRootMeta, type Cell, type Ranges, type RootMetaV1 } from "./lww";

/** Largest plaintext whose §6-padded relock (+28 header/nonce +16 tag) stays under api/src/routes/roots.ts MAX_META (16KB). */
export const MAX_ROOT_META_PLAIN = 12_287;

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SEQ = /^[1-9][0-9]{0,18}$/;
const ENGINE = /^([0-9a-hjkmnp-tv-z]{26}|-)$/;
const aad = (userId: string, rootId: string, version: number) => ({ userId, rootId, version: String(version) });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCell = (c: unknown): c is Cell => isObj(c) && "value" in c && typeof c.at === "string" && TIME.test(c.at)
  && typeof c.engine === "string" && ENGINE.test(c.engine) && typeof c.seq === "string" && SEQ.test(c.seq);
const isRanges = (r: unknown): r is Ranges => Array.isArray(r) && r.every((x) => Array.isArray(x) && x.length === 2 && x.every((s) => typeof s === "string" && SEQ.test(s)));

export function sealRootMeta(mk: Uint8Array, userId: string, rootId: string, meta: RootMetaV1): string {
  const pt = utf8(JSON.stringify(meta));
  if (pt.length > MAX_ROOT_META_PLAIN) throw new Error("root_meta_too_large");
  const k = subkey(mk, "root_meta");
  try {
    return toB64u(relock(k, "root_meta", aad(userId, rootId, meta.version), pt));
  } finally {
    k.fill(0);
  }
}

export function openRootMeta(mk: Uint8Array, userId: string, row: RootRow): RootMetaV1 {
  if (row.list_meta === null) {
    if (row.meta_version !== 0) throw new Error("root_meta_invalid");
    return emptyRootMeta();
  }
  const k = subkey(mk, "root_meta");
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(unlock(k, "root_meta", aad(userId, row.root_id, row.meta_version), fromB64u(row.list_meta))));
  } catch {
    throw new Error("root_meta_invalid");
  } finally {
    k.fill(0);
  }
  if (!isObj(raw) || raw.v !== 1 || raw.version !== row.meta_version || !isObj(raw.cells) || !Object.values(raw.cells).every(isCell)
    || !isObj(raw.merged) || !Object.values(raw.merged).every(isRanges)) throw new Error("root_meta_invalid");
  return { v: 1, version: row.meta_version, cells: raw.cells as Record<string, Cell>, merged: raw.merged as Record<string, Ranges> };
}

export interface OpenedRoots { metas: ReadonlyMap<string, RootMetaV1>; issues: readonly ChainIssue[] }

/** Every root's merged meta. A rolled-back or unreadable one is reported and left out (nothing is merged onto it). */
export function openRootMetas(v: { userId: string; mk: Uint8Array }, sync: SyncState, marks: VersionStore): OpenedRoots {
  const metas = new Map<string, RootMetaV1>();
  const issues: ChainIssue[] = [];
  for (const row of sync.roots.values()) {
    const key = metaMark(v.userId, row.root_id);
    if (sync.complete && BigInt(row.meta_version) < seenMax(marks, key)) {
      issues.push({ kind: "rollback", what: "root_meta", id: row.root_id });
      continue;
    }
    try {
      metas.set(row.root_id, openRootMeta(v.mk, v.userId, row));
    } catch {
      issues.push({ kind: "unreadable", table: "roots", id: row.root_id });
      continue;
    }
    if (sync.complete) rememberMax(marks, key, BigInt(row.meta_version));
  }
  return { metas, issues };
}
