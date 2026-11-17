import { describe, expect, it } from "vitest";
import { encodeBase32, formatTime, newId } from "./ids";

describe("ids §2", () => {
  it("known encodings", () => {
    expect(encodeBase32(new Uint8Array(16).fill(0xff))).toBe("z".repeat(25) + "w");
    expect(encodeBase32(new Uint8Array(16))).toBe("0".repeat(26));
  });
  it("10k unique, 26 chars, no forbidden chars", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10000; i++) {
      const id = newId();
      expect(id).toMatch(/^[0-9a-hjkmnp-tv-z]{26}$/);
      seen.add(id);
    }
    expect(seen.size).toBe(10000);
  });
  it("time format", () => expect(formatTime(new Date("2026-11-14T14:12:03.999+09:00"))).toBe("2026-11-14T05:12:03Z"));
});
