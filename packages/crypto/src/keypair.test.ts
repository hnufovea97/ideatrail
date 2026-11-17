import { describe, expect, it } from "vitest";
import { kemPublicOf, newKemKeyPair, randomKey, signPublicKey } from "./keypair";
import { fromHex, toHex } from "./bytes";

describe("key helpers", () => {
  it("X25519 public key matches RFC 7748 §6.1", () => {
    const priv = fromHex("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a");
    expect(toHex(kemPublicOf(priv))).toBe("8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a");
  });
  it("Ed25519 public key matches RFC 8032 test 1", () => {
    const seed = fromHex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
    expect(toHex(signPublicKey(seed))).toBe("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
  });
  it("new key pairs are 32 bytes and differ each time", () => {
    const a = newKemKeyPair();
    const b = newKemKeyPair();
    expect(a.priv.length).toBe(32);
    expect(a.pub).toEqual(kemPublicOf(a.priv));
    expect(toHex(a.priv)).not.toBe(toHex(b.priv));
    expect(randomKey().length).toBe(32);
  });
});
