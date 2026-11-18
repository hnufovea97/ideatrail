import { expect, test, type Page } from "@playwright/test";
import type { FakeEngine, SuggestedFolder } from "./helpers/fake-engine";
import { githubLater, openSignup, passStepOne, saveRecoveryKey, skipPhone } from "./helpers/flow";

const PROJECT: SuggestedFolder = { path: "/Users/e2e/Projects/ideatrail", name: "아이디어 로그", files: 18, current: true };
const BUDGET: SuggestedFolder = { path: "/Users/e2e/Projects/가계부 앱", name: "가계부 앱", files: 12, current: false };

async function toFolders(page: Page, folders: SuggestedFolder[]): Promise<{ engine: FakeEngine; approvalId: string }> {
  const { engine } = await openSignup(page);
  await passStepOne(page, engine);
  const approvalId = await engine.postSignupSelect(folders); // the real engine does this right after the handoff
  await skipPhone(page);
  await githubLater(page);
  await saveRecoveryKey(page);
  return { engine, approvalId };
}

test("current project is on, suggestions off; the choice reaches the engine sealed and bound", async ({ page }) => {
  const { engine, approvalId } = await toFolders(page, [PROJECT, BUDGET]);
  await expect(page.getByRole("checkbox", { name: /지금 프로젝트 · 아이디어 로그 \(문서 18개\)/ })).toBeChecked();
  const budget = page.getByRole("checkbox", { name: /가계부 앱 \(문서 12개\)/ });
  await expect(budget).not.toBeChecked();
  await budget.check();
  const decided = page.waitForResponse((r) => r.url().endsWith(`/v1/approvals/${approvalId}/decide`) && r.status() === 200);
  await page.getByRole("button", { name: "기록하기" }).click();
  await decided;
  const msgs = await engine.readInbox([approvalId]);
  expect(msgs.map((m) => m.body)).toEqual([expect.objectContaining({ v: 1, type: "select_folders", approval_id: approvalId, folders: [PROJECT.path, BUDGET.path] })]);
});

test("nothing chosen → 새 기록부터 (rejected, empty list)", async ({ page }) => {
  const { engine, approvalId } = await toFolders(page, [PROJECT]);
  await page.getByRole("checkbox", { name: /아이디어 로그/ }).uncheck();
  await expect(page.getByText("고른 폴더가 없어요. 앞으로 생기는 변화부터 기록해요")).toBeVisible();
  const decided = page.waitForResponse((r) => r.url().endsWith(`/v1/approvals/${approvalId}/decide`));
  await page.getByRole("button", { name: "새 기록부터 시작하기" }).click();
  const res = await decided;
  expect(JSON.parse(res.request().postData() ?? "{}").decision).toBe("rejected");
  const msgs = await engine.readInbox([approvalId]);
  expect(msgs[0].body.folders).toEqual([]);
});

test("201 files → told it goes in two parts", async ({ page }) => {
  await toFolders(page, [{ ...PROJECT, files: 150 }, { ...BUDGET, files: 51 }]);
  await page.getByRole("checkbox", { name: /가계부 앱/ }).check();
  await expect(page.getByText("한 번에 200개까지예요. 나머지 1개는 다음에 바뀔 때 기록해요")).toBeVisible();
});
