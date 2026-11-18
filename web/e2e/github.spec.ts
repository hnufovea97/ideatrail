import { expect, test } from "@playwright/test";
import { githubLater, openSignup, passStepOne, skipPhone } from "./helpers/flow";
import { expectClean, watch } from "./helpers/guards";

test("[GitHub에 보관함 만들기] → engine inbox gets connect_github → signed storage link → next step", async ({ page }) => {
  const w = await watch(page);
  const { engine } = await openSignup(page);
  await passStepOne(page, engine);
  await skipPhone(page);
  await page.getByRole("button", { name: "GitHub에 보관함 만들기" }).click();
  await expect(page.getByText("GitHub 화면에서 코드를 붙여 넣고 [Authorize]까지 눌러 주세요. 끝나면 이 화면이 저절로 넘어가요.")).toBeVisible();
  const msgs = await engine.readInbox();
  expect(msgs.map((m) => m.body.type)).toEqual(["connect_github"]);
  await engine.putStorageLink();
  await expect(page.getByRole("heading", { name: /비상 열쇠/ })).toBeVisible();
  await expect(page.getByRole("list", { name: "필요한 것 5가지" }).getByRole("listitem").nth(2)).toContainText("끝냄");
  await expectClean(page, w);
});

test("[나중에] moves on without contacting the engine", async ({ page }) => {
  const w = await watch(page);
  const { engine } = await openSignup(page);
  await passStepOne(page, engine);
  await skipPhone(page);
  await githubLater(page);
  expect(w.requests.filter((r) => r.url.endsWith("/v1/inbox"))).toEqual([]);
});

test("[나중에] stays available while waiting for GitHub", async ({ page }) => {
  const { engine } = await openSignup(page);
  await passStepOne(page, engine);
  await skipPhone(page);
  await page.getByRole("button", { name: "GitHub에 보관함 만들기" }).click();
  await expect(page.getByRole("status").filter({ hasText: "GitHub 화면에서 코드를" })).toBeVisible();
  await expect(page.getByRole("button", { name: "GitHub에 보관함 만들기" })).toHaveCount(0);
  await githubLater(page);
});
