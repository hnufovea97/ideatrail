import { ed25519, x25519 } from "@noble/curves/ed25519.js";

const KEY_LEN = 32;

export interface KemKeyPair {
  priv: Uint8Array;
  pub: Uint8Array;
}

/** Fresh X25519 key pair (account key AK, device-add temporary key T). */
export function newKemKeyPair(): KemKeyPair {
  const priv = x25519.utils.randomSecretKey();
  return { priv, pub: x25519.getPublicKey(priv) };
}

export const kemPublicOf = (priv: Uint8Array): Uint8Array => x25519.getPublicKey(priv);

/** Ed25519 public key of a 32-byte seed (engine signing key; the fake engine in E2E uses this). */
export const signPublicKey = (seed: Uint8Array): Uint8Array => ed25519.getPublicKey(seed);

/** 32 random bytes from the platform CSPRNG (MK, RK, psk, qpsk). */
export const randomKey = (): Uint8Array => crypto.getRandomValues(new Uint8Array(KEY_LEN));
