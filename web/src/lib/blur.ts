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
  doc.addEventListener("visibilitychange", visibility);
  return () => {
    win.removeEventListener("blur", on);
    win.removeEventListener("pagehide", on);
    win.removeEventListener("focus", off);
    doc.removeEventListener("visibilitychange", visibility);
  };
}
