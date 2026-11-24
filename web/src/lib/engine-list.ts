import { fromB64u, toB64u, utf8 } from "@ideatrail/crypto/bytes";
import { relock, unlock } from "@ideatrail/crypto/relock";
import { subkey } from "@ideatrail/crypto/subkey";
import { assertLive } from "./live-key";

/**
 * Spec §15 M5a: a disconnected engine stays listed so its earlier rows still verify. At disconnect the list freezes
 * `revoked_after_seq` (decimal uint64, the highest log_seq accepted from it) and `revoked_digest` (sync/verify.ts
 * revokedDigest over its accepted rows up to that seq). Its rows count only if those at or below the cutoff hash to
 * exactly the digest — its key could backdate a signed time or re-sign an old seq. `revoked_at` is for display only.
 * Missing cutoff or digest: none of its rows count. Writing these at disconnect is 5.9 (M5d).
 */
export interface EngineEntry {
  engine_id: string; sign_pubkey: string; kem_pubkey: string; name: string; added_at: string; revoked_at?: string; revoked_after_seq?: string; revoked_digest?: string;
}
export interface EngineList { v: 1; version: number; engines: EngineEntry[] }

const aad = (userId: string, version: number) => ({ userId, version: String(version) });

/** Spec §15 M4: relock(subkey(MK,"engine_list"), "engine_list", {user_id, version:"N"}, JSON). */
/** The engine-list subkey for one use, zeroed afterwards on every path. */
function withListKey<T>(mk: Uint8Array, use: (k: Uint8Array) => T): T {
  assertLive(mk); // a vault wiped by the lock must not seal or open anything
  const k = subkey(mk, "engine_list");
  try {
    return use(k);
  } finally {
    k.fill(0);
  }
}

export function sealEngineList(mk: Uint8Array, userId: string, list: EngineList): string {
  return withListKey(mk, (k) => toB64u(relock(k, "engine_list", aad(userId, list.version), utf8(JSON.stringify(list)))));
}

const isEntry = (e: unknown): e is EngineEntry => {
  const x = e as Record<string, unknown>;
  return !!x && ["engine_id", "sign_pubkey", "kem_pubkey", "name", "added_at"].every((k) => typeof x[k] === "string");
};

export function openEngineList(mk: Uint8Array, userId: string, version: number, blob: string): EngineList {
  const list = JSON.parse(new TextDecoder().decode(withListKey(mk, (k) => unlock(k, "engine_list", aad(userId, version), fromB64u(blob))))) as EngineList;
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
