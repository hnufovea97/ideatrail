import { describe, expect, it } from "vitest";
import { pad, paddedLen, unpad } from "./pad";

describe("pad §6", () => {
  const cases: [number, number][] = [[0, 256], [1, 256], [255, 256], [256, 512], [4095, 4096], [4096, 8192], [9000, 12288]];
  for (const [n, want] of cases) {
    it(`${n} → ${want}`, () => {
      expect(paddedLen(n)).toBe(want);
      const p = pad(new Uint8Array(n).fill(0x80));
      expect(p.length).toBe(want);
      expect(unpad(p).length).toBe(n);
    });
  }
  it("rejects bad padding", () => {
    expect(() => unpad(new Uint8Array(256))).toThrow("bad_padding");
    expect(() => unpad(Uint8Array.of(0x80))).toThrow("bad_padding");
    const wrongTail = new Uint8Array(256); wrongTail[255] = 1;
    expect(() => unpad(wrongTail)).toThrow("bad_padding");
  });
});
