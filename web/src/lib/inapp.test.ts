import { describe, expect, it } from "vitest";
import { externalOpenUrl, inAppBrowser } from "./inapp";

const KAKAO = "Mozilla/5.0 (Linux; Android 15; SM-S731N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36 KAKAOTALK 25.9.1";
const CHROME = "Mozilla/5.0 (Linux; Android 15; SM-S731N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";

describe("inAppBrowser (G2: passkeys fail inside chat-app browsers)", () => {
  it("finds KakaoTalk and other app browsers", () => {
    expect(inAppBrowser(KAKAO)).toBe("kakao");
    expect(inAppBrowser(CHROME.replace("Mobile", "NAVER(inapp; search) Mobile"))).toBe("other");
    expect(inAppBrowser(`${CHROME} Instagram 300.0`)).toBe("other");
    expect(inAppBrowser(`${CHROME} [FBAN/FB4A;FBAV/400.0]`)).toBe("other");
    expect(inAppBrowser(`${CHROME} Line/14.0`)).toBe("other");
  });
  it("leaves real browsers alone", () => {
    expect(inAppBrowser(CHROME)).toBeNull();
    expect(inAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBeNull();
  });
  it("opens KakaoTalk links in the phone's own browser", () => {
    expect(externalOpenUrl("kakao", "https://x.dev/home/?a=1")).toBe("kakaotalk://web/openExternal?url=https%3A%2F%2Fx.dev%2Fhome%2F%3Fa%3D1");
    expect(externalOpenUrl("other", "https://x.dev/home/")).toBeNull();
  });
});
