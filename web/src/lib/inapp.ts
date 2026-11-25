// Chat and social apps open links in their own browser, where passkeys fail (G2 2026-11-24:
// KakaoTalk on Android gave NotReadableError right after the phone lock). Detect it and send the user out.
export type InApp = "kakao" | "whale" | "other";

const OTHER = /NAVER\(inapp|Instagram|FBAN|FBAV|\bLine\/|DaumApps|everytimeApp|Whale\/.*inapp/i;

export function inAppBrowser(ua: string): InApp | null {
  if (/KAKAOTALK/i.test(ua)) return "kakao";
  if (OTHER.test(ua)) return "other";
  // G2 2026-11-25: Whale on Android never answered the device-lock prompt (open and recovery both). Windows not tested.
  return /Android/.test(ua) && /\bWhale\//.test(ua) ? "whale" : null;
}

/** KakaoTalk's own scheme, or an Android intent to Chrome for Whale; other apps only offer it in their menu. */
export function externalOpenUrl(kind: InApp, href: string): string | null {
  if (kind === "kakao") return `kakaotalk://web/openExternal?url=${encodeURIComponent(href)}`;
  if (kind === "whale") return `intent://${href.replace(/^https:\/\//, "")}#Intent;scheme=https;package=com.android.chrome;end`; // Android: open in Chrome
  return null;
}
