import { describe, expect, it } from "vitest";
import { bytesEqual, deviceJoinMac, deviceKeyMac, pairMac } from "./mac";
import { concat, toHex, utf8 } from "./bytes";

const psk = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const sid = "01jcm3v8q7s2kx4f9d6b5n0tqw";
const range = (n: number) => Uint8Array.from({ length: n }, (_, i) => i);

describe("spec §9·§10 HMACs", () => {
  it("pair = HMAC(psk, 'ideatrail/v1/pair' ‖ session_id ‖ payload)", () => {
    const payload = concat(utf8("IT1"), Uint8Array.of(8), range(40));
    expect(toHex(pairMac(psk, sid, payload))).toBe("2579d802bccbe868d9040d4860a2b5fcf6f32aaed5082ff3fa1605800a355222");
  });
  it("da-join = HMAC(qpsk, 'ideatrail/v1/da-join' ‖ d ‖ t_pub)", () => {
    expect(toHex(deviceJoinMac(psk, sid, new Uint8Array(32).fill(7)))).toBe("ba7c23a4d7b30c60101d1051b36f62f9aa8cc436e14b9ca815b3dbe3a647fee1");
  });
  it("da-key = HMAC(qpsk, 'ideatrail/v1/da-key' ‖ d ‖ sealed)", () => {
    const sealed = concat(utf8("IT1"), Uint8Array.of(9), range(48));
    expect(toHex(deviceKeyMac(psk, sid, sealed))).toBe("1882fe9b4a09449e1862b8c46dc040f334c45512fc109453550cbf0372030ab5");
  });
  it("refuses a key that is not 32 bytes", () => {
    expect(() => pairMac(new Uint8Array(31), sid, range(4))).toThrow("bad_key");
  });
  it("bytesEqual compares length and every byte", () => {
    expect(bytesEqual(range(4), range(4))).toBe(true);
    expect(bytesEqual(range(4), range(5))).toBe(false);
    expect(bytesEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(false);
  });
});
