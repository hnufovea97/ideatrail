import { describe, expect, it } from "vitest";
import { buildAAD, joinFields, SEP_AAD } from "./format";

const ID = "01jcm3v8q7s2kx4f9d6b5n0tqw";

describe("format", () => {
  it("rejects separators", () => {
    expect(() => joinFields(SEP_AAD, ["a\x1fb"])).toThrow("bad_field");
    expect(() => joinFields(SEP_AAD, ["a\nb"])).toThrow("bad_field");
  });
  it("empty → dash", () => expect(new TextDecoder().decode(buildAAD("x", {}))).toBe("IT1\x1fx\x1f-\x1f-\x1f-\x1f-\x1f1"));
  it("validates id and version fields", () => {
    expect(() => buildAAD("x", { userId: "u" })).toThrow("bad_field");
    expect(() => buildAAD("x", { userId: ID.toUpperCase() })).toThrow("bad_field");
    expect(() => buildAAD("x", { userId: ID, version: "v1" })).toThrow("bad_field");
    expect(() => buildAAD("x", { userId: ID, version: "0" })).not.toThrow();
  });
});
