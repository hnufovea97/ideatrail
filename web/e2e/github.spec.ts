import { expect, test } from "@playwright/test";
import { githubLater, openSignup, passStepOne, skipPhone } from "./helpers/flow";
import { expectClean, watch } from "./helpers/guards";

test("[GitHub에 보관하기] → engine inbox gets connect_github → signed storage link → next step", async ({ page }) => {
  const w = await watch(page);
  const { engine } = await openSignup(page);
  await passStepOne(page, engine);
  await skipPhone(page);
  await page.getByRole("button", { name: "GitHub에 보관하기" }).click();
  await expect(page.getByText("GitHub 승인 페이지에서 코드를 붙여 넣고 [승인]을 눌러 주세요. 끝나면 저절로 넘어가요.")).toBeVisible();
  const msgs = await engine.readInbox();
  expect(msgs.map((m) => m.body.type)).toEqual(["connect_github"]);
  await engine.putStorageLink();
  await expect(page.getByRole("heading", { name: "GitHub 보관" })).toHaveCount(0); // step 4 screen and its checklist: Task 12
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
