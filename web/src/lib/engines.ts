// Engine management in the unlocked dashboard (5.9a): disconnect writes the cutoff into the engine list (spec §15 M5a).
import { formatTime } from "@ideatrail/crypto/ids";
import type { EngineEntry, EngineList } from "./engine-list";
import { sealEngineList } from "./engine-list";
import { openRepoAccess } from "./mirror/storage";
import type { LinkRow } from "./sync/rows";
import type { DeltaRow, RecordRow } from "./sync/rows";
import { revokedDigest } from "./sync/verify";

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
  const only: EngineList = { ...list, engines: list.engines.filter((e) => e.engine_id === engineId) };
  const access = await openRepoAccess(v, only, [...links].filter((l) => l.engine_id === engineId));
  return access?.token ?? null;
}
