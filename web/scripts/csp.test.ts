import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { injectMeta, policyFor } from "./csp";

const hash = (s: string) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>astro-island{display:contents}</style>` +
  `<script type="module" src="/_astro/a.js"></script><script>customElements.define("x",class{})</script></head><body></body></html>`;

describe("CSP for built pages", () => {
  it("hashes inline scripts and styles only, and allows exactly the API origin", () => {
    const p = policyFor(html, "http://localhost:8787");
    expect(p).toContain(`script-src 'self' ${hash('customElements.define("x",class{})')}`);
    expect(p).toContain(`style-src 'self' ${hash("astro-island{display:contents}")}`);
    expect(p).toContain("connect-src 'self' http://localhost:8787;");
    expect(p).toContain("default-src 'none'");
    expect(p).not.toContain("unsafe-inline");
  });
  it("puts the meta tag right after <meta charset>, before any script", () => {
    const out = injectMeta(html, "default-src 'none'");
    expect(out.indexOf('http-equiv="Content-Security-Policy"')).toBeLessThan(out.indexOf("<script"));
    expect(out.indexOf('<meta charset="utf-8">')).toBeLessThan(out.indexOf("Content-Security-Policy"));
  });
  it("refuses a page without <meta charset> (the policy could land after a script)", () => {
    expect(() => injectMeta("<html><head><script>1</script></head></html>", "x")).toThrow("no_meta_charset");
  });
});
