// Engine management in the unlocked dashboard (5.9a): disconnect writes the cutoff into the engine list (spec §15 M5a).
import { formatTime } from "@ideatrail/crypto/ids";
import { sealEngineList, type EngineEntry, type EngineList, type VersionStore } from "./engine-list";
import { assertLive } from "./live-key";
import { openRepoAccess } from "./mirror/storage";
import type { DeltaRow, LinkRow, RecordRow } from "./sync/rows";
import type { SyncState } from "./sync/store";
import { revokedDigest, verifyRows } from "./sync/verify";

export const isLive = (e: EngineEntry): boolean => e.revoked_at === undefined && e.revoked_after_seq === undefined && e.revoked_digest === undefined;
export const liveEngines = (list: EngineList): EngineEntry[] => list.engines.filter(isLive);

export interface AcceptedRows { records: readonly RecordRow[]; deltas: readonly DeltaRow[] }

const maxSeq = (rows: AcceptedRows): bigint =>
  [...rows.records, ...rows.deltas].reduce((m, r) => (BigInt(r.log_seq) > m ? BigInt(r.log_seq) : m), 0n);

/**
 * The next engine list (version + 1) with this engine frozen: `revoked_after_seq` = the highest log_seq among `rows`
 * (this engine's rows that passed verification), `revoked_digest` over those same rows. Never mutates `list`.
 */
export function revokeList(list: EngineList, engineId: string, rows: AcceptedRows, userId: string, now: Date): EngineList {
  const mine = { records: rows.records.filter((r) => r.engine_id === engineId), deltas: rows.deltas.filter((d) => d.engine_id === engineId) };
  const frozen = { revoked_at: formatTime(now), revoked_after_seq: maxSeq(mine).toString(), revoked_digest: revokedDigest(userId, mine) };
  return { v: 1, version: list.version + 1, engines: list.engines.map((e) => (e.engine_id === engineId ? { ...e, ...frozen } : e)) };
}

/** The sealed engine list for the revoke request. */
export const sealRevoked = (mk: Uint8Array, userId: string, list: EngineList): string => sealEngineList(mk, userId, list);

/** That engine's own GitHub access token (kind 6), or null. Sent once in a revoke body; never stored or logged. */
export async function githubTokenFor(v: { userId: string; akPriv: Uint8Array }, list: EngineList, links: Iterable<LinkRow>, engineId: string): Promise<string | null> {
  assertLive(v.akPriv); // a wiped key is an abort, not "no token"
  const only: EngineList = { ...list, engines: list.engines.filter((e) => e.engine_id === engineId) };
  const access = await openRepoAccess(v, only, [...links].filter((l) => l.engine_id === engineId));
  return access?.token ?? null;
}

/** The marks of this browser, readable but never written: a disconnect check must not move what a refresh judges by. */
export const readOnly = (s: VersionStore): VersionStore => ({ get: (k) => s.get(k), set: () => undefined });

export type DisconnectPlan = { ok: true; next: EngineList } | { ok: false };

/**
 * The list that freezes this engine, or `ok: false` when its rows are not all accounted for (any row of it that fails a check,
 * a hole, a duplicate or a seq below what this browser has seen): revoking an engine that cannot be fully verified is not
 * offered. The digest is over exactly the rows `verifyRows` keeps for it, and the new list is verified once more against the
 * same rows (spec §15 M5a) so a later refresh cannot call it a mismatch.
 */
export function planDisconnect(userId: string, list: EngineList, sync: SyncState, marks: VersionStore, engineId: string, now: Date): DisconnectPlan {
  if (!sync.complete) return { ok: false };
  const ro = readOnly(marks);
  const accepted = verifyRows(userId, list, sync, ro, { now });
  const owner = (id: string) => sync.records.get(id)?.engine_id ?? sync.deltas.get(id)?.engine_id;
  const mine = accepted.issues.some((i) => {
    if (i.kind === "bad_row") return true; // cannot tell whose it was
    if (i.kind === "gap" || i.kind === "duplicate_seq" || i.kind === "revoked_mismatch") return i.engineId === engineId;
    if (i.kind === "rollback") return i.what === "log_seq" && i.id === engineId;
    if (i.kind === "bad_signature" || i.kind === "future_time") return owner(i.id) === engineId;
    return false;
  });
  if (mine) return { ok: false };
  const next = revokeList(list, engineId, accepted, userId, now);
  const again = verifyRows(userId, next, sync, ro, { now });
  if (again.issues.some((i) => i.kind === "revoked_mismatch" && i.engineId === engineId)) return { ok: false };
  return { ok: true, next };
}
