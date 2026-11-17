import { ed25519 } from "@noble/curves/ed25519.js";
import { fromB64u, toB64u } from "./bytes";

export * from "./message";

const SEED_LEN = 32;
const PUB_LEN = 32;
const SIG_LEN = 64;

export function sign(seed: Uint8Array, msg: Uint8Array): string {
  if (seed.length !== SEED_LEN) throw new Error("bad_key");
  return toB64u(ed25519.sign(msg, seed));
}

/** Strict RFC 8032 verification (zip215: false) to match Go crypto/ed25519 and WebCrypto. */
export function verify(pub: Uint8Array, msg: Uint8Array, sig: string): boolean {
  if (pub.length !== PUB_LEN) return false;
  try {
    const raw = fromB64u(sig);
    if (raw.length !== SIG_LEN) return false;
    return ed25519.verify(raw, msg, pub, { zip215: false });
  } catch {
    return false;
  }
}
