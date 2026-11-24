import { expect, test, type Page } from "@playwright/test";
import { BUDGET, deviceView, openHome } from "./helpers/home";
import { expectClean, watch } from "./helpers/guards";

test.use({ timezoneId: "Asia/Seoul" });

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const width of [375, 1280]) {
  test(`no sideways scroll at ${width}px: list, idea life, server view on and off (5.11)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openHome(page);
    expect(await overflow(page)).toBe(0);
    await deviceView(page);
    expect(await overflow(page)).toBe(0);
    await page.locator(".cards .card").filter({ hasText: BUDGET }).click();
    await expect(page.locator(".life")).toBeVisible();
    expect(await overflow(page)).toBe(0);
    await page.getByLabel("Ideatrail 서버가 가진 데이터").check();
    expect(await overflow(page)).toBe(0);
  });
}

test("phone width: one column — a card opens the idea life, [목록으로] comes back", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openHome(page);
  await deviceView(page);
  await page.locator(".cards .card").filter({ hasText: BUDGET }).click();
  await expect(page.locator(".home-list")).toBeHidden();
  await page.getByRole("button", { name: "목록으로" }).click();
  await expect(page.locator(".home-list")).toBeVisible();
  await expect(page.locator(".life")).toHaveCount(0);
});

test("dark mode follows the device and uses the design-system tokens (디자인시스템 §5.1.1)", async ({ page }) => {
  const w = await watch(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await openHome(page);
  const color = (sel: string, prop: "backgroundColor" | "color") => page.locator(sel).first().evaluate((el, p) => getComputedStyle(el)[p], prop);
  expect(await color("body", "backgroundColor")).toBe("rgb(31, 31, 30)"); // --bg #1F1F1E
  expect(await color(".card", "backgroundColor")).toBe("rgb(44, 44, 42)"); // --card #2C2C2A
  await page.emulateMedia({ colorScheme: "light" });
  expect(await color("body", "backgroundColor")).toBe("rgb(255, 255, 255)");
  expect(await color(".bar i.on", "backgroundColor")).toBe("rgb(24, 95, 165)"); // --primary #185FA5
  await expectClean(page, w);
});
