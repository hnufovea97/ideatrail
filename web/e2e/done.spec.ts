import { expect, test } from "@playwright/test";
import { githubLater, openSignup, passStepOne, saveRecoveryKey, skipPhone } from "./helpers/flow";
import { expectClean, watch } from "./helpers/guards";

test("end screen: 3 lines, the GitHub banner stays until the engine's link arrives", async ({ page }) => {
  const w = await watch(page);
  const { engine } = await openSignup(page);
  await passStepOne(page, engine);
  await engine.postSignupSelect([{ path: "/Users/e2e/p", name: "p", files: 1, current: true }]);
  await skipPhone(page);
  await githubLater(page);
  await saveRecoveryKey(page);
  await page.getByRole("button", { name: "기록하기" }).click();
  await expect(page.getByRole("heading", { name: "준비됐어요", exact: true })).toBeVisible();
  await expect(page.getByTestId("done-how")).toMatchAriaSnapshot(`
    - heading "앞으로 이렇게 동작해요" [level=2]
    - list:
      - listitem: AI와 작업하면 의미 있는 변화만 저절로 기록해요. 터미널에 한 줄로 알려 드려요
      - listitem: 기록은 몇 시간 뒤 블록체인에 날짜가 새겨져요
      - listitem: 공개로 바꾸기·지우기는 이 대시보드에서 당신만 할 수 있어요
  `);
  const banner = page.getByRole("region", { name: "GitHub 보관" });
  await expect(banner).toContainText("증명을 GitHub에 보관하세요 · PC의 Claude Code에서 이어서 해요");
  await expect(page.getByText("휴대폰에서도 열려요.")).toHaveCount(0); // phone was skipped
  const sent = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/v1/inbox"));
  await banner.getByRole("button", { name: "지금 연결" }).click();
  expect((await sent).status()).toBe(201);
  expect((await engine.readInbox()).map((m) => m.body.type)).toEqual(["connect_github"]);
  await expect(banner).toBeVisible(); // still there while the engine has not linked
  await engine.putStorageLink();
  await expect(banner).toHaveCount(0);
  await expectClean(page, w);
});

test("nothing chosen → the end screen says new records start from now", async ({ page }) => {
  const { engine } = await openSignup(page);
  await passStepOne(page, engine);
  await engine.postSignupSelect([{ path: "/Users/e2e/p", name: "p", files: 1, current: true }]);
  await skipPhone(page);
  await githubLater(page);
  await saveRecoveryKey(page);
  await page.getByRole("checkbox", { name: /p/ }).uncheck();
  await page.getByRole("button", { name: "새 기록부터 시작하기" }).click();
  await expect(page.getByRole("heading", { name: "준비됐어요", exact: true })).toBeVisible();
  await expect(page.getByText("새 기록부터 남겨요")).toBeVisible();
});
