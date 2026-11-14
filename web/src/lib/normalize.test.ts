import { describe, expect, it } from "vitest";
import { fromHex, normalizePath } from "./commit";

describe("fromHex", () => {
  it("decodes lowercase and uppercase hex", () => {
    expect([...fromHex("00ffAB")]).toEqual([0, 255, 171]);
  });
  for (const bad of ["abc", "zz", "1g", "0x00", " 00"]) {
    it(`rejects ${JSON.stringify(bad)}`, () => expect(() => fromHex(bad)).toThrow("invalid_hex"));
  }
});

describe("normalizePath", () => {
  it("converts backslash, NFD→NFC, keeps case", () => {
    expect(normalizePath("src\\a.go")).toBe("src/a.go");
    expect(normalizePath("메모.md")).toBe("메모.md");
    expect(normalizePath("Read.MD")).toBe("Read.MD");
  });
  for (const bad of ["", "/a", "a/", "a//b", ".", "a/./b", "a\\..\\b", "\\a", "bad\ud800.md"]) {
    it(`rejects ${JSON.stringify(bad)}`, () => expect(() => normalizePath(bad)).toThrow("invalid_path"));
  }
});
