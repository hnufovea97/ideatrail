// Defence in depth for the lock: a lock wipes the open vault's keys in place (zeros). Anything about to use a key
// checks it first, and anything that waited (device-lock prompt, network) asks the open vault's signal afterwards.
import { assertLiveKey } from "@ideatrail/crypto/relock";

/** Thrown by `guard` when the vault was locked while an action waited. Never shown: the lock screen is already up. */
export class VaultLocked extends Error {
  constructor() {
    super("vault_locked");
    this.name = "VaultLocked";
  }
}

/** Throws "zero_key" for a key a lock has wiped. Call before the key is used (a subkey of zeros is not zeros). */
export function assertLive(...keys: readonly Uint8Array[]): void {
  for (const k of keys) assertLiveKey(k);
}

/** Throws VaultLocked once the vault's signal is aborted. */
export function guard(signal?: AbortSignal): void {
  if (signal?.aborted) throw new VaultLocked();
}

/** True for the failures a lock causes: the screen says nothing about them. */
export const isLockedError = (e: unknown, signal?: AbortSignal): boolean =>
  signal?.aborted === true || e instanceof VaultLocked || (e instanceof Error && e.message === "zero_key");
