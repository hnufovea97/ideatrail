// UX: 앱/탭 전환 시 화면 흐림 — the recent-apps preview must not keep private titles. CSS does the blur (global.css).
export const BLUR_CLASS = "privacy-blur";

interface BlurDoc extends EventTarget {
  readonly visibilityState: string;
  readonly documentElement: { classList: { add(c: string): void; remove(c: string): void } };
}

export function bindPrivacyBlur(win: EventTarget, doc: BlurDoc): () => void {
  const on = () => doc.documentElement.classList.add(BLUR_CLASS);
  const off = () => doc.documentElement.classList.remove(BLUR_CLASS);
  const visibility = () => (doc.visibilityState === "hidden" ? on() : off());
  win.addEventListener("blur", on);
  win.addEventListener("pagehide", on);
  win.addEventListener("focus", off);
  win.addEventListener("pointerdown", off); // Android sends no focus after the fingerprint sheet: a touch means the user is here
  doc.addEventListener("visibilitychange", visibility);
  return () => {
    win.removeEventListener("blur", on);
    win.removeEventListener("pagehide", on);
    win.removeEventListener("focus", off);
    win.removeEventListener("pointerdown", off);
    doc.removeEventListener("visibilitychange", visibility);
  };
}


/** After the passkey sheet closes: the page is in front again, so drop the cover the sheet's blur put up. */
export function clearPrivacyBlur(doc: Pick<BlurDoc, "visibilityState" | "documentElement">): void {
  if (doc.visibilityState === "visible") doc.documentElement.classList.remove(BLUR_CLASS);
}
