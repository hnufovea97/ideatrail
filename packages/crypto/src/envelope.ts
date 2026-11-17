import { ed25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { freshNonce, lockRaw, unlockRaw } from "./aead-internal";
import { toB64u, toHex, utf8 } from "./bytes";
import { recoveryProofMessage } from "./message";
import { CRYPTO_VERSION, idField, joinFields, SEP_AAD } from "./format";
import { KEY_LEN } from "./subkey";

export const ENVELOPE_KIND = 0x80;
const LOOKUP_HEX_CHARS = 32;

/** PRF eval.first input — same for every user (spec §11, ADR-0013). */
export const PRF_SALT = sha256(utf8("ideatrail/v1/prf-salt"));

function need32(b: Uint8Array): Uint8Array {
  if (b.length !== KEY_LEN) throw new Error("bad_key");
  return b;
}

/** wrap = HKDF-SHA256(ikm=PRF output, salt="ideatrail/v1/prf-wrap", info=credential_id bytes). */
export const prfWrapKey = (prfOutput: Uint8Array, credentialId: Uint8Array): Uint8Array =>
  hkdf(sha256, need32(prfOutput), utf8("ideatrail/v1/prf-wrap"), credentialId, KEY_LEN);

/** wrap = HKDF-SHA256(ikm=RK, salt="ideatrail/v1/recovery-wrap", info=user_id). */
export const recoveryWrapKey = (rk: Uint8Array, userId: string): Uint8Array =>
  hkdf(sha256, need32(rk), utf8("ideatrail/v1/recovery-wrap"), utf8(idField(userId)), KEY_LEN);

export const envelopeAAD = (userId: string, envelopeId: string): Uint8Array =>
  utf8(joinFields(SEP_AAD, ["IT1", "envelope", idField(userId), idField(envelopeId), CRYPTO_VERSION]));

/** Wrap the 32-byte master key with a fresh random nonce. */
export const wrapMasterKey = (wrap: Uint8Array, mk: Uint8Array, userId: string, envelopeId: string): Uint8Array =>
  lockRaw(wrap, ENVELOPE_KIND, envelopeAAD(userId, envelopeId), need32(mk), freshNonce());

export function unwrapMasterKey(wrap: Uint8Array, userId: string, envelopeId: string, blob: Uint8Array): Uint8Array {
  const mk = unlockRaw(wrap, ENVELOPE_KIND, envelopeAAD(userId, envelopeId), blob);
  if (mk.length !== KEY_LEN) throw new Error("decrypt_failed");
  return mk;
}

/** lookup_id = first 32 hex chars of HKDF-SHA256(ikm=RK, salt="ideatrail/v1/recovery-lookup", info="", 32 bytes). */
export const recoveryLookupId = (rk: Uint8Array): string =>
  toHex(hkdf(sha256, need32(rk), utf8("ideatrail/v1/recovery-lookup"), new Uint8Array(0), KEY_LEN)).slice(0, LOOKUP_HEX_CHARS);

/** The only value the server stores: hex(SHA-256(lookup_id)). */
export const lookupHash = (lookupId: string): string => toHex(sha256(utf8(lookupId)));

/**
 * Ed25519 key derived from RK. Its public half is stored with the recovery envelope; signing the
 * server's challenge proves the caller holds RK, not just lookup_id (M2a security review).
 */
export function recoveryVerifyKey(rk: Uint8Array): { seed: Uint8Array; publicKey: Uint8Array } {
  const seed = hkdf(sha256, need32(rk), utf8("ideatrail/v1/recovery-verify"), new Uint8Array(0), KEY_LEN);
  return { seed, publicKey: ed25519.getPublicKey(seed) };
}

export const recoveryProof = (rk: Uint8Array, challenge: string): string =>
  toB64u(ed25519.sign(recoveryProofMessage(challenge), recoveryVerifyKey(rk).seed));
