import { freshNonce, lockRaw, unlockRaw } from "./aead-internal";
import { buildAAD, type AAD } from "./format";

/** Relock purposes in spec §3 order; kind byte = 0x80 + (index + 1). */
export const PURPOSES = ["account_priv", "root_meta", "prefs", "recall_notes", "reminder_state", "index_roots", "index_records", "engine_list", "export"] as const;
export type Purpose = (typeof PURPOSES)[number];

export function relockKind(purpose: string): number {
  const i = (PURPOSES as readonly string[]).indexOf(purpose);
  if (i < 0) throw new Error("unknown_purpose");
  return 0x80 + i + 1;
}

/** Encrypt the browser's own data under subkey(purpose) with a fresh random nonce (spec §5). */
export const relock = (key: Uint8Array, purpose: Purpose, a: AAD, pt: Uint8Array): Uint8Array =>
  lockRaw(key, relockKind(purpose), buildAAD(purpose, a), pt, freshNonce());

export const unlock = (key: Uint8Array, purpose: Purpose, a: AAD, blob: Uint8Array): Uint8Array =>
  unlockRaw(key, relockKind(purpose), buildAAD(purpose, a), blob);
