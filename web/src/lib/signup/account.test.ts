import { describe, expect, it } from "vitest";
import { fromB64u } from "@ideatrail/crypto/bytes";
import { prfWrapKey, unwrapMasterKey } from "@ideatrail/crypto/envelope";
import { randomKey } from "@ideatrail/crypto/keypair";
import { unlock } from "@ideatrail/crypto/relock";
import { subkey } from "@ideatrail/crypto/subkey";
import { makeEnvelope, newAccount } from "./account";

const USER = "01jcm3v8q7s2kx4f9d6b5n0tqw";
const prf = new Uint8Array(32).fill(5);
const rawId = Uint8Array.of(1, 2, 3, 4);

describe("new account (spec §3, §11)", () => {
  it("wraps MK under the PRF key of this credential and it unwraps again", () => {
    const a = newAccount(USER, prf, rawId);
    const mk = unwrapMasterKey(prfWrapKey(prf, rawId), USER, a.envelope.envelope_id, fromB64u(a.envelope.wrapped_master_key));
    expect(mk).toEqual(a.vault.mk);
  });
  it("relocks the account private key under subkey(account_priv) with AAD {user_id}", () => {
    const a = newAccount(USER, prf, rawId);
    const ak = unlock(subkey(a.vault.mk, "account_priv"), "account_priv", { userId: USER }, fromB64u(a.account.wrapped_account_privkey));
    expect(ak).toEqual(a.vault.akPriv);
    expect(fromB64u(a.account.account_pubkey)).toEqual(a.vault.akPub);
  });
  it("a different credential id cannot unwrap the envelope", () => {
    const a = newAccount(USER, prf, rawId);
    expect(() => unwrapMasterKey(prfWrapKey(prf, Uint8Array.of(9)), USER, a.envelope.envelope_id, fromB64u(a.envelope.wrapped_master_key))).toThrow("decrypt_failed");
  });
  it("makeEnvelope gives a fresh envelope id each time", () => {
    const mk = randomKey();
    expect(makeEnvelope(mk, USER, prf, rawId).envelope_id).not.toBe(makeEnvelope(mk, USER, prf, rawId).envelope_id);
  });
});
