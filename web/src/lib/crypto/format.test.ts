import { describe, expect, it } from "vitest";
import { buildAAD, joinFields, SEP_AAD } from "./format";

describe("format", () => {
  it("rejects separators", () => {
    expect(() => joinFields(SEP_AAD, ["a\x1fb"])).toThrow("bad_field");
    expect(() => joinFields(SEP_AAD, ["a\nb"])).toThrow("bad_field");
  });
  it("empty → dash", () => expect(new TextDecoder().decode(buildAAD("x", {}))).toBe("IT1\x1fx\x1f-\x1f-\x1f-\x1f-\x1f1"));
});
