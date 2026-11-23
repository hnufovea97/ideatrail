import { fromB64u, toB64u, utf8 } from "@ideatrail/crypto/bytes";
import { relock, unlock } from "@ideatrail/crypto/relock";
import { subkey } from "@ideatrail/crypto/subkey";

/**
 * Spec §15 M5a: a disconnected engine stays listed so its earlier rows still verify. `revoked_after_seq` (decimal
 * uint64) freezes the cutoff — the highest log_seq accepted from it at disconnect time; only rows at or below it
 * count (its key could backdate a signed time, never a seq below the cutoff). `revoked_at` is for display only.
 * Without `revoked_after_seq`, a revoked engine's rows are all refused. Writing both at disconnect is 5.9 (M5d).
 */
export interface EngineEntry {
  engine_id: string; sign_pubkey: string; kem_pubkey: string; name: string; added_at: string; revoked_at?: string; revoked_after_seq?: string;
}
export interface EngineList { v: 1; version: number; engines: EngineEntry[] }

const aad = (userId: string, version: number) => ({ userId, version: String(version) });

/** Spec §15 M4: relock(subkey(MK,"engine_list"), "engine_list", {user_id, version:"N"}, JSON). */
export function sealEngineList(mk: Uint8Array, userId: string, list: EngineList): string {
  return toB64u(relock(subkey(mk, "engine_list"), "engine_list", aad(userId, list.version), utf8(JSON.stringify(list))));
}

const isEntry = (e: unknown): e is EngineEntry => {
  const x = e as Record<string, unknown>;
  return !!x && ["engine_id", "sign_pubkey", "kem_pubkey", "name", "added_at"].every((k) => typeof x[k] === "string");
};

export function openEngineList(mk: Uint8Array, userId: string, version: number, blob: string): EngineList {
  const list = JSON.parse(new TextDecoder().decode(unlock(subkey(mk, "engine_list"), "engine_list", aad(userId, version), fromB64u(blob)))) as EngineList;
  if (list.v !== 1 || list.version !== version || !Array.isArray(list.engines) || !list.engines.every(isEntry)) throw new Error("engine_list_invalid");
  return list;
}

export function addEngine(prev: EngineList | null, entry: EngineEntry, prevVersion: number): EngineList {
  const others = (prev?.engines ?? []).filter((e) => e.engine_id !== entry.engine_id);
  return { v: 1, version: prevVersion + 1, engines: [...others, entry] };
}

export interface VersionStore { get(key: string): string | null; set(key: string, value: string): void }

/** localStorage, but never throws (private mode, blocked storage). */
export function browserStore(): VersionStore {
  return {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked: rollback check falls back to this session only */ } },
  };
}

export function memoryStore(): VersionStore {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
}

const key = (userId: string) => `it.elv.${userId}`;
const seen = (s: VersionStore, userId: string) => Number(s.get(key(userId)) ?? "0") || 0;

export function rememberVersion(s: VersionStore, userId: string, version: number): void {
  if (version > seen(s, userId)) s.set(key(userId), String(version));
}

/** Spec §8: a lower engine_list_version than this browser has seen is a server rollback. */
export const isRollback = (s: VersionStore, userId: string, version: number): boolean => version < seen(s, userId);
