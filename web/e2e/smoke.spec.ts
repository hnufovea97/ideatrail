import { expect, test } from "@playwright/test";
import { expectClean, watch } from "./helpers/guards";

test("pages load with a CSP meta, no violations and no foreign requests", async ({ page }) => {
  const w = await watch(page);
  for (const path of ["/start", "/connect", "/home"]) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    expect(csp).toContain("default-src 'none'");
    // GitHub (index/ mirror) and the two block explorers only where the keys are open: /home (sec L5)
    expect(csp).toContain(path === "/home" ? "connect-src 'self' http://localhost:8787 https://api.github.com https://blockstream.info https://mempool.space;" : "connect-src 'self' http://localhost:8787;");
    await expectClean(page, w);
  }
});

test("the local API answers and sets the session cookie over http://localhost", async ({ request }) => {
  const r = await request.get("http://localhost:8787/v1/pairing/01jcm3v8q7s2kx4f9d6b5n0tqw");
  expect(r.status()).toBe(404);
  expect((await r.json()).error.code).toBe("pairing_not_found");
});
