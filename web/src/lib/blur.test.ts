import { describe, expect, it } from "vitest";
import { BLUR_CLASS, bindPrivacyBlur, clearPrivacyBlur } from "./blur";

function fakeDoc() {
  const classes = new Set<string>();
  const doc = Object.assign(new EventTarget(), {
    visibilityState: "visible",
    documentElement: { classList: { add: (c: string) => void classes.add(c), remove: (c: string) => void classes.delete(c) } },
  });
  return { doc, classes };
}

describe("privacy blur on app switch (5.1)", () => {
  it("blurs when the window loses focus and clears when it comes back", () => {
    const win = new EventTarget();
    const { doc, classes } = fakeDoc();
    bindPrivacyBlur(win, doc);
    win.dispatchEvent(new Event("blur"));
    expect(classes.has(BLUR_CLASS)).toBe(true);
    win.dispatchEvent(new Event("focus"));
    expect(classes.has(BLUR_CLASS)).toBe(false);
  });
  it("blurs when the page is hidden (recent-apps snapshot) or left", () => {
    const win = new EventTarget();
    const { doc, classes } = fakeDoc();
    bindPrivacyBlur(win, doc);
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(classes.has(BLUR_CLASS)).toBe(true);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(classes.has(BLUR_CLASS)).toBe(false);
    win.dispatchEvent(new Event("pagehide"));
    expect(classes.has(BLUR_CLASS)).toBe(true);
  });
  it("unbinding stops it", () => {
    const win = new EventTarget();
    const { doc, classes } = fakeDoc();
    bindPrivacyBlur(win, doc)();
    win.dispatchEvent(new Event("blur"));
    expect(classes.size).toBe(0);
  });
});

describe("the cover does not stay after the phone lock sheet (G2 2026-11-24)", () => {
  it("a touch on the visible page clears it", () => {
    const win = new EventTarget();
    const { doc, classes } = fakeDoc();
    bindPrivacyBlur(win, doc);
    win.dispatchEvent(new Event("blur")); // Android: the fingerprint sheet blurs the window and no focus comes back
    win.dispatchEvent(new Event("pointerdown"));
    expect(classes.has(BLUR_CLASS)).toBe(false);
  });
  it("clearPrivacyBlur clears only while the page is visible", () => {
    const { doc, classes } = fakeDoc();
    classes.add(BLUR_CLASS);
    doc.visibilityState = "hidden";
    clearPrivacyBlur(doc);
    expect(classes.has(BLUR_CLASS)).toBe(true);
    doc.visibilityState = "visible";
    clearPrivacyBlur(doc);
    expect(classes.has(BLUR_CLASS)).toBe(false);
  });
});
