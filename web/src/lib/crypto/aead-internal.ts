// XChaCha20-Poly1305 framing shared by relock (§5) and envelopes (§11).
// Internal: only relock.ts, envelope.ts and testing.ts import this. Callers never pick nonces.
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { concat } from "./bytes";
import { hasMagic, MAGIC } from "./format";
import { pad, unpad } from "./pad";
import { KEY_LEN } from "./subkey";

export const NONCE_LEN = 24;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + 1;

export function lockRaw(key: Uint8Array, kind: number, aad: Uint8Array, pt: Uint8Array, nonce: Uint8Array): Uint8Array {
  if (key.length !== KEY_LEN || nonce.length !== NONCE_LEN) throw new Error("bad_key");
  return concat(MAGIC, Uint8Array.of(kind), nonce, xchacha20poly1305(key, nonce, aad).encrypt(pad(pt)));
}

export function unlockRaw(key: Uint8Array, kind: number, aad: Uint8Array, blob: Uint8Array): Uint8Array {
  if (key.length !== KEY_LEN) throw new Error("bad_key");
  try {
    if (blob.length < HEADER_LEN + NONCE_LEN + TAG_LEN || !hasMagic(blob) || blob[3] !== kind) throw new Error();
    const nonce = blob.subarray(HEADER_LEN, HEADER_LEN + NONCE_LEN);
    return unpad(xchacha20poly1305(key, nonce, aad).decrypt(blob.subarray(HEADER_LEN + NONCE_LEN)));
  } catch {
    throw new Error("decrypt_failed");
  }
}

export const freshNonce = (): Uint8Array => crypto.getRandomValues(new Uint8Array(NONCE_LEN));
