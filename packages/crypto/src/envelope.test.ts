import { describe, expect, it } from "vitest";
import e from "../../../spec/vectors/envelope.json";
import { PRF_SALT, prfWrapKey, recoveryWrapKey, wrapMasterKey, unwrapMasterKey, recoveryLookupId, lookupHash } from "./envelope";
import { wrapMasterKeyWithNonce } from "./testing";
import { formatRecoveryKey, parseRecoveryKey } from "./recovery";
import { fromHex, toHex } from "./bytes";

const prf = fromHex(e.prf_output_hex), cred = fromHex(e.credential_id_hex), mk = fromHex(e.mk_hex);

describe("envelope §11", () => {
  it("prf salt", () => expect(toHex(PRF_SALT)).toBe(e.prf_salt_hex));
  it("passkey wrap key and envelope match Go", () => {
    const w = prfWrapKey(prf, cred);
    expect(toHex(w)).toBe(e.wrap_hex);
    expect(toHex(wrapMasterKeyWithNonce(w, mk, e.user_id, e.envelope_id, fromHex(e.nonce_hex)))).toBe(e.envelope_hex);
    expect(toHex(unwrapMasterKey(w, e.user_id, e.envelope_id, fromHex(e.envelope_hex)))).toBe(e.mk_hex);
  });
  it("random-nonce wrap round-trips", () => {
    const w = prfWrapKey(prf, cred);
    expect(toHex(unwrapMasterKey(w, e.user_id, e.envelope_id, wrapMasterKey(w, mk, e.user_id, e.envelope_id)))).toBe(e.mk_hex);
  });
  it("another credential_id or envelope_id cannot unwrap", () => {
    expect(() => unwrapMasterKey(prfWrapKey(prf, new Uint8Array(16)), e.user_id, e.envelope_id, fromHex(e.envelope_hex))).toThrow("decrypt_failed");
    expect(() => unwrapMasterKey(prfWrapKey(prf, cred), e.user_id, e.user_id, fromHex(e.envelope_hex))).toThrow("decrypt_failed");
  });
  it("only 32-byte master keys and PRF outputs", () => {
    const w = prfWrapKey(prf, cred);
    expect(() => wrapMasterKey(w, new Uint8Array(31), e.user_id, e.envelope_id)).toThrow("bad_key");
    expect(() => prfWrapKey(new Uint8Array(16), cred)).toThrow("bad_key");
    const short = wrapMasterKeyWithNonce(w, new Uint8Array(32), e.user_id, e.envelope_id, new Uint8Array(24));
    expect(unwrapMasterKey(w, e.user_id, e.envelope_id, short)).toHaveLength(32);
  });
});

describe("recovery key §11", () => {
  const r = e.recovery;
  it("display: 52 chars in 13 groups", () => {
    expect(formatRecoveryKey(fromHex(r.rk_hex))).toBe(r.rk_display);
    expect(r.rk_display.split("-")).toHaveLength(13);
  });
  it("parse is forgiving about case, spaces and look-alikes", () => {
    const sloppy = r.rk_display.toUpperCase().replace(/-/g, " ").replace(/1/g, "l").replace(/0/g, "O");
    expect(toHex(parseRecoveryKey(sloppy))).toBe(r.rk_hex);
  });
  it("recovery wrap, envelope and lookup match Go", () => {
    const rk = parseRecoveryKey(r.rk_display);
    expect(toHex(recoveryWrapKey(rk, e.user_id))).toBe(r.wrap_hex);
    expect(toHex(unwrapMasterKey(recoveryWrapKey(rk, e.user_id), e.user_id, e.envelope_id, fromHex(r.envelope_hex)))).toBe(e.mk_hex);
    expect(recoveryLookupId(rk)).toBe(r.lookup_id);
    expect(lookupHash(r.lookup_id)).toBe(r.lookup_hash);
  });
  it("one wrong character cannot unwrap", () => {
    const first = r.rk_display[0] === "a" ? "b" : "a";
    const rk = parseRecoveryKey(first + r.rk_display.slice(1));
    expect(() => unwrapMasterKey(recoveryWrapKey(rk, e.user_id), e.user_id, e.envelope_id, fromHex(r.envelope_hex))).toThrow("decrypt_failed");
  });
  it("rejects malformed input", () => {
    expect(() => parseRecoveryKey("abc")).toThrow("bad_recovery_key");
    expect(() => parseRecoveryKey("u".repeat(52))).toThrow("bad_recovery_key");
    expect(() => parseRecoveryKey("z".repeat(52))).toThrow("bad_recovery_key"); // trailing bits not zero
  });
});
