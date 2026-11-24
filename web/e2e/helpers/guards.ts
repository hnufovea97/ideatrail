import { expect, type Page } from "@playwright/test";

export const APP = "http://localhost:4321";
export const API = "http://localhost:8787";
/** The two block explorers only answer the /home confirmation check (5.7); the specs route them to local fakes. */
const ALLOWED = new Set([APP, API, "https://blockstream.info", "https://mempool.space"]);

export interface Watch { requests: { url: string; method: string; body: string }[] }

/** Record every request and every CSP violation of this page (the init script is not subject to CSP). */
export async function watch(page: Page): Promise<Watch> {
  const w: Watch = { requests: [] };
  page.on("request", (r) => w.requests.push({ url: r.url(), method: r.method(), body: r.postData() ?? "" }));
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return w;
}

/** CSP violations 0 and no request outside the app and API origins (CLAUDE.md rule 7). */
export async function expectClean(page: Page, w: Watch) {
  const violations = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
  expect(violations).toEqual([]);
  const foreign = w.requests.map((r) => new URL(r.url)).filter((u) => u.protocol !== "data:" && !ALLOWED.has(u.origin)).map((u) => u.origin);
  expect(foreign).toEqual([]);
}
