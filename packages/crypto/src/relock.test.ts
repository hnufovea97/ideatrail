import { afterEach, describe, expect, it, vi } from "vitest";
import sk from "../../../spec/vectors/subkey.json";
import xc from "../../../spec/vectors/xchacha.json";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { subkey } from "./subkey";
import { relock, unlock, PURPOSES, type Purpose } from "./relock";
import { relockWithNonce } from "./testing";
import { fromHex, toHex, utf8 } from "./bytes";

const O = "01jcm3v8q7s2kx4f9d6b5n0tqz";

describe("subkey §3", () => {
  for (const [p, hex] of Object.entries(sk.subkeys)) it(p, () => expect(toHex(subkey(fromHex(sk.mk_hex), p))).toBe(hex));
  it("rejects a master key that is not 32 bytes", () => expect(() => subkey(new Uint8Array(31), "prefs")).toThrow("bad_key"));
});

describe("xchacha §5", () => {
  it("draft-irtf-cfrg-xchacha-03 A.3.1", () => {
    const s = xc.standard;
    const ct = xchacha20poly1305(fromHex(s.key_hex), fromHex(s.nonce_hex), fromHex(s.aad_hex)).encrypt(fromHex(s.plaintext_hex));
    expect(toHex(ct)).toBe(s.ciphertext_and_tag_hex);
  });
  for (const v of xc.ours) {
    it(`relock ${v.purpose} matches Go`, () => {
      const key = subkey(fromHex(xc.mk_hex), v.purpose);
      const a = { userId: v.user_id, rootId: v.root_id };
      expect(toHex(relockWithNonce(key, v.purpose, a, fromHex(v.plaintext_hex), fromHex(v.nonce_hex)))).toBe(v.sealed_hex);
      expect(toHex(unlock(key, v.purpose as Purpose, a, fromHex(v.sealed_hex)))).toBe(v.plaintext_hex);
    });
  }
  it("moved blob fails (user_id, root_id, purpose)", () => {
    const v = { ...xc.ours[0], purpose: xc.ours[0].purpose as Purpose };
    const key = subkey(fromHex(xc.mk_hex), v.purpose);
    const blob = fromHex(v.sealed_hex);
    expect(() => unlock(key, v.purpose, { userId: O, rootId: v.root_id }, blob)).toThrow("decrypt_failed");
    expect(() => unlock(key, v.purpose, { userId: v.user_id, rootId: O }, blob)).toThrow("decrypt_failed");
    expect(() => unlock(key, xc.ours[1].purpose as Purpose, { userId: v.user_id, rootId: v.root_id }, blob)).toThrow("decrypt_failed");
  });
  it("truncated or wrong-magic blob fails", () => {
    const v = { ...xc.ours[0], purpose: xc.ours[0].purpose as Purpose };
    const key = subkey(fromHex(xc.mk_hex), v.purpose);
    const a = { userId: v.user_id, rootId: v.root_id };
    const bad = fromHex(v.sealed_hex); bad[0] = 0x58;
    expect(() => unlock(key, v.purpose, a, bad)).toThrow("decrypt_failed");
    expect(() => unlock(key, v.purpose, a, fromHex(v.sealed_hex).subarray(0, 30))).toThrow("decrypt_failed");
  });
});

describe("nonce source", () => {
  afterEach(() => vi.restoreAllMocks());
  it("every relock draws a fresh 24-byte nonce from crypto.getRandomValues", () => {
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues");
    const key = new Uint8Array(32);
    const a = relock(key, PURPOSES[0], {}, utf8("x"));
    const b = relock(key, PURPOSES[0], {}, utf8("x"));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls.every(([arr]) => (arr as Uint8Array).length === 24)).toBe(true);
    expect(toHex(a.subarray(4, 28))).not.toBe(toHex(b.subarray(4, 28)));
  });
});
