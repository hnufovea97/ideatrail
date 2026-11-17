import { describe, expect, it } from "vitest";
import rfc from "../../../../spec/vectors/hpke_rfc9180.json";
import ours from "../../../../spec/vectors/hpke_ideatrail.json";
import { open, openAuth, seal, sealAuth, KIND } from "./seal";
import { recipientContext } from "./testing";
import { buildAAD, type AAD } from "./format";
import { fromHex, toHex, utf8 } from "./bytes";

const U = "01jcm3v8q7s2kx4f9d6b5n0tqw", R = "01jcm3v8q7s2kx4f9d6b5n0tqx", X = "01jcm3v8q7s2kx4f9d6b5n0tqy", O = "01jcm3v8q7s2kx4f9d6b5n0tqz";
const v1 = ours.vectors[0];
const v7 = ours.vectors.find((v) => v.kind === 7)!;
const skR = fromHex(v1.recipient_priv_hex), pkR = fromHex(v1.recipient_pub_hex);
const good: AAD = { userId: U, rootId: R, recordId: X, version: "0" };

describe("RFC 9180 (mode 0x00, 0x02)", () => {
  for (const v of rfc) {
    it(`mode ${v.mode}: all encryptions from one context, in sequence`, async () => {
      const ctx = await recipientContext({
        recipientPriv: fromHex(v.skRm), enc: fromHex(v.enc), info: fromHex(v.info),
        senderPub: v.mode === 2 ? fromHex(v.pkSm!) : undefined,
      });
      for (const e of v.encryptions) {
        expect(toHex(new Uint8Array(await ctx.open(fromHex(e.ct).slice().buffer, fromHex(e.aad).slice().buffer)))).toBe(e.pt);
      }
    });
  }
});

describe("hpke_ideatrail kinds 1–11 (Go → TS)", () => {
  for (const v of ours.vectors) {
    it(`${v.kind} ${v.kind_name}`, async () => {
      const a = { userId: v.user_id, rootId: v.root_id, recordId: v.record_id, version: v.version };
      expect(toHex(buildAAD(v.kind_name, a))).toBe(v.aad_hex);
      const sealed = fromHex(v.sealed_hex);
      const pt = v.kind === 7
        ? await openAuth(v.kind, fromHex(v.recipient_priv_hex), fromHex(v.sender_pub_hex!), a, sealed)
        : await open(v.kind, fromHex(v.recipient_priv_hex), a, sealed);
      expect(toHex(pt)).toBe(v.plaintext_hex);
    });
  }
});

describe("TS seal", () => {
  it("round trip + layout", async () => {
    const s = await seal(KIND.record_meta, pkR, good, utf8("hi"));
    expect(s.length).toBe(4 + 32 + 256 + 16);
    expect(new TextDecoder().decode(await open(KIND.record_meta, skR, good, s))).toBe("hi");
  });
  it("original is not padded", async () => {
    const s = await seal(KIND.original, pkR, good, utf8("abc"));
    expect(s.length).toBe(4 + 32 + 3 + 16);
  });
  it("moved ciphertext fails for every AAD field", async () => {
    const s = await seal(KIND.record_meta, pkR, good, utf8("x"));
    for (const a of [{ ...good, userId: O }, { ...good, rootId: O }, { ...good, recordId: O }, { ...good, version: "1" }]) {
      await expect(open(KIND.record_meta, skR, a, s)).rejects.toThrow("decrypt_failed");
    }
    const flipped = s.slice(); flipped[3] = KIND.record_body;
    await expect(open(KIND.record_body, skR, good, flipped)).rejects.toThrow("decrypt_failed");
    await expect(open(KIND.record_body, skR, good, s)).rejects.toThrow("decrypt_failed");
  });
  it("malformed blobs → decrypt_failed", async () => {
    const s = await seal(KIND.delta, pkR, good, utf8("x"));
    const badMagic = s.slice(); badMagic[0] = 0x58;
    const zeroEnc = s.slice(); zeroEnc.fill(0, 4, 36);
    for (const b of [new Uint8Array(0), s.subarray(0, 40), s.subarray(0, 35), badMagic, zeroEnc]) {
      await expect(open(KIND.delta, skR, good, b)).rejects.toThrow("decrypt_failed");
    }
  });
  it("seal to all-zero public key fails", async () => {
    await expect(seal(KIND.delta, new Uint8Array(32), good, utf8("x"))).rejects.toThrow();
  });
  it("auth mode is kind 7 only, and checks the sender", async () => {
    const a = { userId: U, rootId: O, recordId: X };
    await expect(seal(KIND.engine_inbox, pkR, a, utf8("x"))).rejects.toThrow("auth_mode_mismatch");
    await expect(sealAuth(KIND.record_meta, pkR, fromHex(v7.sender_priv_hex!), a, utf8("x"))).rejects.toThrow("auth_mode_mismatch");
    const s = await sealAuth(KIND.engine_inbox, pkR, fromHex(v7.sender_priv_hex!), a, utf8("x"));
    expect(toHex(await openAuth(KIND.engine_inbox, skR, fromHex(v7.sender_pub_hex!), a, s))).toBe("78");
    await expect(openAuth(KIND.engine_inbox, skR, pkR, a, s)).rejects.toThrow("decrypt_failed");
    await expect(open(KIND.engine_inbox, skR, a, s)).rejects.toThrow("auth_mode_mismatch");
  });
});
