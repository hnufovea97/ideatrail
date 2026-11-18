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
  await expect(page.getByTestId("done-made")).toMatchAriaSnapshot(`
    - heading "만든 것" [level=2]
    - list:
      - listitem: 열쇠 · 이 컴퓨터 평소에 기록을 열 때 써요
      - listitem: "예비 열쇠 · 휴대폰 (아직 안 만들었어요) 휴대폰으로 볼 때, 컴퓨터를 잃었을 때 써요"
      - listitem: 증명 보관함 · 내 GitHub (아직 안 만들었어요) 우리 서비스가 없어져도 증명을 꺼낼 때 써요
      - listitem: 비상 열쇠 · 종이·비밀번호 관리자 컴퓨터와 휴대폰을 모두 잃었을 때만 써요
  `);
  await expect(page.getByTestId("done-next")).toContainText("“아이디어 상태 알려줘”");
  await expect(page.getByText("✓ 고른 폴더를 기록하기 시작했어요. 몇 분 걸릴 수 있어요")).toBeVisible();
  const banner = page.getByRole("region", { name: "증명 보관함 만들기" });
  await expect(banner).toContainText("증명 보관함을 아직 안 만들었어요. 만들어 두면 증명이 내 GitHub에도 남아요");
  await expect(page.getByText("휴대폰에서도 열려요.")).toHaveCount(0); // phone was skipped
  const sent = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/v1/inbox"));
  await banner.getByRole("button", { name: "지금 만들기" }).click();
  expect((await sent).status()).toBe(201);
  expect((await engine.readInbox()).map((m) => m.body.type)).toEqual(["connect_github"]);
  await expect(banner).toBeVisible(); // still there while the engine has not linked
  await engine.putStorageLink();
  await expect(banner).toHaveCount(0);
  await expect(page.getByTestId("done-made").getByRole("listitem").nth(2)).not.toContainText("아직 안 만들었어요");
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
