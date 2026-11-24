// Chat and social apps open links in their own browser, where passkeys fail (G2 2026-11-24:
// KakaoTalk on Android gave NotReadableError right after the phone lock). Detect it and send the user out.
export type InApp = "kakao" | "other";

const OTHER = /NAVER\(inapp|Instagram|FBAN|FBAV|\bLine\/|DaumApps|everytimeApp|Whale\/.*inapp/i;

export function inAppBrowser(ua: string): InApp | null {
  if (/KAKAOTALK/i.test(ua)) return "kakao";
  return OTHER.test(ua) ? "other" : null;
}

/** KakaoTalk's own scheme for "open in the phone's browser"; other apps only offer it in their menu. */
export const externalOpenUrl = (kind: InApp, href: string): string | null =>
  kind === "kakao" ? `kakaotalk://web/openExternal?url=${encodeURIComponent(href)}` : null;
