import { describe, expect, it } from "vitest";
import padData from "../../../../spec/vectors/pad.json";
import idData from "../../../../spec/vectors/ids.json";
import { pad } from "./pad";
import { CROCKFORD, encodeBase32 } from "./ids";
import { fromHex, toHex } from "./bytes";

describe("pad.json (Go)", () => {
  for (const v of padData.vectors) it(`${v.input_len}`, () => expect(pad(new Uint8Array(v.input_len)).length).toBe(v.padded_len));
  it("sample bytes", () => expect(toHex(pad(fromHex(padData.sample_input_hex)))).toBe(padData.sample_padded_hex));
});

describe("ids.json (Go)", () => {
  it("alphabet", () => expect(CROCKFORD).toBe(idData.alphabet));
  for (const v of idData.vectors) it(v.hex, () => expect(encodeBase32(fromHex(v.hex))).toBe(v.base32));
});
