import { toB64u } from "@ideatrail/crypto/bytes";
import { prfWrapKey, unwrapMasterKey, wrapMasterKey } from "@ideatrail/crypto/envelope";
import { newId } from "@ideatrail/crypto/ids";
import { newKemKeyPair, randomKey } from "@ideatrail/crypto/keypair";
import { bytesEqual } from "@ideatrail/crypto/mac";
import { relock, unlock } from "@ideatrail/crypto/relock";
import { subkey } from "@ideatrail/crypto/subkey";
import type { EnvelopeUpload } from "../api";

/** Secrets held in memory while the signup pages are open. */
export interface Vault { userId: string; mk: Uint8Array; akPriv: Uint8Array; akPub: Uint8Array }

export interface NewAccount {
  vault: Vault;
  account: { account_pubkey: string; wrapped_account_privkey: string };
  envelope: EnvelopeUpload;
}

/** Spec §11: wrap MK under this credential's PRF key, then unwrap the same bytes once before upload. */
export function makeEnvelope(mk: Uint8Array, userId: string, prf: Uint8Array, rawId: Uint8Array): EnvelopeUpload {
  const envelopeId = newId();
  const wrapped = wrapMasterKey(prfWrapKey(prf, rawId), mk, userId, envelopeId);
  const back = unwrapMasterKey(prfWrapKey(prf, rawId), userId, envelopeId, wrapped);
  if (!bytesEqual(back, mk)) throw new Error("unwrap_check_failed");
  return { envelope_id: envelopeId, wrapped_master_key: toB64u(wrapped) };
}

/** Spec §3: MK random, AK X25519; AK private relocked under subkey(MK,"account_priv"), AAD {user_id}. */
export function newAccount(userId: string, prf: Uint8Array, rawId: Uint8Array): NewAccount {
  const mk = randomKey();
  const ak = newKemKeyPair();
  const k = subkey(mk, "account_priv");
  const wrappedAk = relock(k, "account_priv", { userId }, ak.priv);
  if (!bytesEqual(unlock(k, "account_priv", { userId }, wrappedAk), ak.priv)) throw new Error("unwrap_check_failed");
  return {
    vault: { userId, mk, akPriv: ak.priv, akPub: ak.pub },
    account: { account_pubkey: toB64u(ak.pub), wrapped_account_privkey: toB64u(wrappedAk) },
    envelope: makeEnvelope(mk, userId, prf, rawId),
  };
}
