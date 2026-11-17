import { describe, expect, it } from "vitest";
import { COPY, CHECKLIST, errorMessage } from "./copy";
import { ApiFailure } from "./api";

const allStrings = (v: unknown): string[] =>
  typeof v === "string" ? [v] : typeof v === "function" ? [String((v as (n: number) => string)(7))] : v && typeof v === "object" ? Object.values(v).flatMap(allStrings) : [];

describe("screen copy", () => {
  it("never mentions coins, scores or grades (CLAUDE.md rule 8)", () => {
    for (const s of [...allStrings(COPY), ...CHECKLIST.map((c) => c.label)]) expect(s).not.toMatch(/코인|비트코인|점수|등급/);
  });
  it("says '기기 잠금' for the user's own unlock, never '지문 확인'/'지문 센서' (founder decision D2)", () => {
    for (const s of allStrings(COPY)) expect(s).not.toMatch(/지문 (확인|센서)/);
    expect(COPY.errors.passkey_cancel).toBe("기기 잠금 확인이 안 됐어요. 다시 해 볼까요?");
  });
  it("uses the UX error table wording", () => {
    expect(COPY.stop.link_mismatch).toBe("이 링크는 이 컴퓨터의 설치와 맞지 않아 멈췄어요. Claude Code에서 설치 링크를 다시 받아 주세요");
    expect(COPY.errors.qr_expired).toBe("2분이 지나서 새로 만들었어요");
    expect(COPY.pc.retryPrf).toBe("한 번만 더 확인할게요");
  });
  it("maps failures to fixed sentences and never echoes server text", () => {
    expect(errorMessage(new ApiFailure(0, "offline"))).toBe(COPY.errors.offline);
    expect(errorMessage(new DOMException("x", "NotAllowedError"))).toBe(COPY.errors.passkey_cancel);
    expect(errorMessage(new Error("server said: secret"))).toBe(COPY.errors.generic);
  });
});
