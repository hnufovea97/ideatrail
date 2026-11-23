import { expect, test, type Page } from "@playwright/test";
import { openSignup, passStepOne } from "./helpers/flow";
import { APP, expectClean, watch } from "./helpers/guards";

const OPEN = "이 기기로 열기";
const LOCK = "지금 잠그기";

/** Finish signup step 1, then leave for /home (step 2 asks before leaving: the keys of that tab are dropped). */
async function signedUp(page: Page) {
  const { engine } = await openSignup(page, { prf: true });
  await passStepOne(page, engine);
  page.once("dialog", (d) => void d.accept());
  await page.goto(`${APP}/home`);
}

test("opens with the device lock: one get with PRF, nothing of it on the wire", async ({ page }) => {
  const w = await watch(page);
  await signedUp(page);
  await page.getByRole("button", { name: OPEN }).click();
  await expect(page.getByRole("button", { name: LOCK })).toBeVisible();
  await expect(page.getByText(/^기록 사슬 정상 · 마지막 확인 \d{1,2}:\d{2}$/)).toBeVisible();
  await expect(page.getByText("아이디어 0개")).toBeVisible();
  const verify = w.requests.find((r) => r.url.endsWith("/v1/webauthn/login/verify"));
  expect(JSON.parse(verify!.body).response.clientExtensionResults).toEqual({});
  expect(w.requests.filter((r) => r.body.includes('"prf"'))).toEqual([]);
  await expectClean(page, w);
});

test("locks after 5 idle minutes and goes back to the lock screen", async ({ page }) => {
  await page.clock.install(); // before any page: time still flows, fastForward jumps it
  await signedUp(page);
  await page.getByRole("button", { name: OPEN }).click();
  await expect(page.getByRole("button", { name: LOCK })).toBeVisible();
  // Preact runs effects after paint on timers the fake clock owns: let them run (the lock starts within this second)
  await page.clock.runFor(1000);
  await page.clock.fastForward("04:50");
  await expect(page.getByRole("button", { name: LOCK })).toBeVisible();
  await page.clock.fastForward("00:15");
  await expect(page.getByRole("button", { name: OPEN })).toBeVisible();
  await expect(page.getByText("5분 동안 쓰지 않아서 잠갔어요. 다시 열어 주세요")).toBeVisible();
});

test("[지금 잠그기] goes back to the lock screen and ends the session", async ({ page }) => {
  const w = await watch(page);
  await signedUp(page);
  await page.getByRole("button", { name: OPEN }).click();
  await page.getByRole("button", { name: LOCK }).click();
  await expect(page.getByRole("button", { name: OPEN })).toBeVisible();
  await expect.poll(() => w.requests.some((r) => r.method === "POST" && r.url.endsWith("/v1/logout"))).toBe(true);
});

test("blurs the whole screen when the window loses focus", async ({ page }) => {
  await signedUp(page);
  await expect(page.getByRole("button", { name: OPEN })).toBeVisible(); // the island has mounted its listeners
  const html = page.locator("html");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(html).toHaveClass(/privacy-blur/);
  await expect(page.locator(".blur-cover")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(html).not.toHaveClass(/privacy-blur/);
});
