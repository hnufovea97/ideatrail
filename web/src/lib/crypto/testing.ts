// Test-only helpers with caller-chosen nonces, for reproducing Go vectors.
// Never import this from application code: reusing a nonce under one key breaks XChaCha20-Poly1305.
import { lockRaw } from "./aead-internal";
import { buildAAD, type AAD } from "./format";
import { relockKind } from "./relock";

export const relockWithNonce = (key: Uint8Array, purpose: string, a: AAD, pt: Uint8Array, nonce: Uint8Array): Uint8Array =>
  lockRaw(key, relockKind(purpose), buildAAD(purpose, a), pt, nonce);
