import { describe, expect, it } from "vitest";
import { canRemoveDevice, storagePlace } from "./devices";

describe("device storage places (5.9b)", () => {
  it("names the known authenticators", () => {
    expect(storagePlace("ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4")).toBe("Google 비밀번호 관리자");
    expect(storagePlace("fbfc3007-154e-4ecc-8c0b-6e020557d7bd")).toBe("iCloud 키체인");
    expect(storagePlace("dd4ec289-e01d-41c9-bb89-70fa845d4bf2")).toBe("iCloud 키체인");
    for (const a of ["08987058-cadc-4b81-b6e1-30de50dcbe96", "9ddd1817-af5a-4672-a2b9-3e3dd95000a9", "6028b017-b1d4-4c02-b4b3-afcdafc96bb2"]) expect(storagePlace(a)).toBe("Windows Hello");
    expect(storagePlace("adce0002-35bc-c60a-648b-0b25f1f05503")).toBe("Chrome(Mac)");
    expect(storagePlace("53414d53-554e-4700-0000-000000000000")).toBe("Samsung Pass");
  });
  it("is case-insensitive; unknown, empty and null read as 기기 잠금", () => {
    expect(storagePlace("EA9B8D66-4D01-1D21-3CE4-B6B48CB575D4")).toBe("Google 비밀번호 관리자");
    expect(storagePlace("00000000-0000-0000-0000-000000000000")).toBe("기기 잠금");
    expect(storagePlace("")).toBe("기기 잠금");
    expect(storagePlace(null)).toBe("기기 잠금");
  });
  it("the remove button is hidden when only one device is left", () => {
    expect(canRemoveDevice(1)).toBe(false);
    expect(canRemoveDevice(0)).toBe(false);
    expect(canRemoveDevice(2)).toBe(true);
  });
});
