import { describe, expect, it } from "vitest";
import { fromB64u, toB64u, toHex } from "@ideatrail/crypto/bytes";
import { recoveryWrapKey, unwrapMasterKey } from "@ideatrail/crypto/envelope";
import { newKemKeyPair, randomKey } from "@ideatrail/crypto/keypair";
import { parseRecoveryKey } from "@ideatrail/crypto/recovery";
import { firstFourMatches, makeRecovery } from "./recovery";

const USER = "01jcm3v8q7s2kx4f9d6b5n0tqw";
const vault = () => { const ak = newKemKeyPair(); return { userId: USER, mk: randomKey(), akPriv: ak.priv, akPub: ak.pub }; };

describe("recovery key (spec §3, §11)", () => {
  it("shows 52 characters in 13 groups of 4", () => {
    expect(makeRecovery(vault()).display).toMatch(/^(?:[0-9A-Z]{4}-){12}[0-9A-Z]{4}$/);
  });
  it("the key as typed back opens the recovery envelope", () => {
    const v = vault();
    const p = makeRecovery(v);
    const mk = unwrapMasterKey(recoveryWrapKey(parseRecoveryKey(p.display.toLowerCase()), USER), USER, p.body.envelope_id, fromB64u(p.body.wrapped_master_key));
    expect(mk).toEqual(v.mk);
  });
  it("the upload carries no form of the key itself", () => {
    const p = makeRecovery(vault());
    const rk = parseRecoveryKey(p.display);
    const sent = JSON.stringify(p.body);
    for (const form of [p.display, p.display.replace(/-/g, ""), p.display.toLowerCase(), p.display.replace(/-/g, "").toLowerCase(), toHex(rk), toB64u(rk)]) expect(sent).not.toContain(form);
    expect(p.body.lookup_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(fromB64u(p.body.verify_pubkey).length).toBe(32);
    expect(Object.keys(p)).toEqual(["display", "body"]); // the raw key is not kept
  });
  it("checks the first four characters, forgiving case, spaces and look-alikes", () => {
    const d = "AB1C-DEFG-…";
    expect(firstFourMatches(d, "ab1c")).toBe(true);
    expect(firstFourMatches(d, " AB1C ")).toBe(true);
    expect(firstFourMatches(d, "ABlC")).toBe(true);
    expect(firstFourMatches(d, "AB1D")).toBe(false);
    expect(firstFourMatches(d, "AB1")).toBe(false);
  });
});
