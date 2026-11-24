// Highest values this browser has seen (spec §15 M5a), like it.elv.<user_id> for the engine list (M4).
// A lower value later means the server rolled back or cut the tail. A new device starts with none (§8 남는 위험).
import type { VersionStore } from "../engine-list";

const DIGITS = /^[0-9]{1,20}$/;

export const seqMark = (userId: string, engineId: string) => `it.seq.${userId}.${engineId}`;
export const apprMark = (userId: string, engineId: string) => `it.aseq.${userId}.${engineId}`; // highest appr_seq seen from an engine (spec §8)
export const repoMark = (userId: string) => `it.repo.${userId}`; // the GitHub repo id the index/ mirror is pinned to
export const metaMark = (userId: string, rootId: string) => `it.mv.${userId}.${rootId}`;

export function seenMax(s: VersionStore, key: string): bigint {
  const v = s.get(key);
  return v !== null && DIGITS.test(v) ? BigInt(v) : 0n;
}

export function rememberMax(s: VersionStore, key: string, value: bigint): void {
  if (value > seenMax(s, key)) s.set(key, value.toString());
}
