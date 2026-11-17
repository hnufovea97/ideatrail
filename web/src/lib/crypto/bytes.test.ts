import { describe, expect, it } from "vitest";
import { concat, fromB64u, fromHex, toB64u, toHex } from "./bytes";

describe("bytes", () => {
  it("hex round trip and strictness", () => {
    expect(toHex(fromHex("00ff7f"))).toBe("00ff7f");
    for (const bad of ["0", "zz", "0g"]) expect(() => fromHex(bad)).toThrow("bad_hex");
  });
  it("base64url round trip, no padding", () => {
    for (const n of [0, 1, 2, 3, 64, 100000]) {
      const b = new Uint8Array(n).map((_, i) => i * 7);
      expect(fromB64u(toB64u(b))).toEqual(b);
      expect(toB64u(b)).not.toMatch(/[+/=]/);
    }
  });
  it("base64url rejects non-canonical and malformed input", () => {
    expect(() => fromB64u("AB")).toThrow("bad_b64u"); // trailing bits set ("AA" is canonical)
    expect(() => fromB64u("A")).toThrow("bad_b64u");
    expect(() => fromB64u("AA==")).toThrow("bad_b64u");
    expect(() => fromB64u("A+")).toThrow("bad_b64u");
  });
  it("concat", () => expect(toHex(concat(Uint8Array.of(1), new Uint8Array(0), Uint8Array.of(2, 3)))).toBe("010203"));
});
