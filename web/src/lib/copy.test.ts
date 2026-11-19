import { describe, expect, it } from "vitest";
import { COPY, CHECKLIST, didLine, errorMessage } from "./copy";
import { initialState } from "./signup/machine";
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
  it("keeps technical words off the screen (plain-language vocabulary)", () => {
    for (const s of [...allStrings(COPY), ...CHECKLIST.map((c) => c.label)]) expect(s).not.toMatch(/패스키|PRF|봉투|HPKE|엔진|서명|복구 키/i);
  });
  it("names the four things with the same words everywhere", () => {
    expect(COPY.intro.map.map((m) => m.name)).toEqual(["열쇠", "예비 열쇠", "증명 보관함", "비상 열쇠"]);
    expect(COPY.intro.map.map((m) => m.where)).toEqual(["이 컴퓨터", "휴대폰", "사용자의 GitHub", "종이·비밀번호 관리자"]);
    expect(COPY.done.made.map((m) => m.key)).toEqual(["pc", "phone", "github", "recovery"]);
    for (const m of COPY.done.made) expect(m.when.length).toBeGreaterThan(0);
    expect(CHECKLIST.map((c) => c.label).slice(0, 4).map((l) => l.split(" (")[0].replace(" [중요]", ""))).toEqual(["열쇠", "예비 열쇠", "증명 보관함", "비상 열쇠"]);
  });
  it("tells, before each action, what will pop up, and after it, what was just made", () => {
    for (const k of ["pc", "phone", "github", "recovery", "folders"] as const) expect(COPY.did[k]).toMatch(/^✓ /);
    expect(COPY.pc.ahead).toContain("Touch ID");
    expect(didLine({ ...initialState, justDid: "pc" })).toBe("✓ 이 컴퓨터에 열쇠를 만들었어요. 사용자의 기록은 이 열쇠로만 열려요");
    expect(didLine(initialState)).toBeNull();
    expect(COPY.intro.time).toContain("5분");
  });
  it("uses the UX error table wording", () => {
    expect(COPY.stop.link_mismatch).toBe("이 링크는 이 컴퓨터의 설치와 맞지 않아 멈췄어요. Claude Code에서 설치 링크를 다시 받아 주세요");
    expect(COPY.errors.qr_expired).toBe("2분이 지나서 새로 만들었어요");
    expect(COPY.pc.retryPrf).toBe("한 번만 더 확인할게요");
  });
  it("never implies the server holds the content (founder: '우리도 못 연다' reads as 'we keep it, locked')", () => {
    for (const s of allStrings(COPY)) expect(s).not.toMatch(/우리도 못 열|우리 서버도 열지 못|우리는 못 열어/);
    expect(COPY.intro.server).toContain("32바이트");
    expect(COPY.intro.server).toContain("파일 지문");
  });

  it("keeps two clear subjects — 'Ideatrail' (the service) and '사용자' (the user) — never an ambiguous 내/우리 (founder G1)", () => {
    for (const s of allStrings(COPY)) {
      expect(s).not.toMatch(/우리|저희|당신/);
      expect(s).not.toMatch(/(^|[\s(])내 /);
    }
  });

  it("opens with the user's own moment, then what they get — benefits before setup (founder: marketer view)", () => {
    expect(COPY.intro.title).toContain("이거 괜찮은데?");
    expect(COPY.intro.what).toContain("기록해 줘");
    expect(COPY.intro.benefits.map((b) => b.key)).toEqual(["say", "find", "safe"]);
    // the not-yet-built overview is always marked, never promised as if it exists
    expect(COPY.intro.example.laterTitle).toContain("곧 생겨요");
    expect(COPY.intro.benefits[1].body).toContain("곧");
    expect(COPY.done.next[0]).toContain("기록해 줘");
    // "기억해 줘" reads as setting the AI's memory (founder); the record words are the user's own
    for (const s of allStrings(COPY)) expect(s).not.toContain("기억해");
    expect(COPY.intro.benefits[0].body).toContain("편한 말");
  });
  it("maps failures to fixed sentences and never echoes server text", () => {
    expect(errorMessage(new ApiFailure(0, "offline"))).toBe(COPY.errors.offline);
    expect(errorMessage(new DOMException("x", "NotAllowedError"))).toBe(COPY.errors.passkey_cancel);
    expect(errorMessage(new Error("server said: secret"))).toBe(COPY.errors.generic);
  });
});
