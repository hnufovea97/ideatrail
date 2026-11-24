import { expect, test, type Page } from "@playwright/test";
import { toB64u } from "@ideatrail/crypto/bytes";
import { recoveryLookupId } from "@ideatrail/crypto/envelope";
import { parseRecoveryKey } from "@ideatrail/crypto/recovery";
import { openHomeWith } from "./helpers/home";
import { API, APP, watch } from "./helpers/guards";

const FOLDER = { path: "/Users/e2e/Projects/새 폴더", name: "새 폴더", files: 7 };
const wake = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); // the dashboard pulls again

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await expect(page.getByRole("heading", { name: "자동 잠금" })).toBeVisible();
}

test("approvals: a cancelled device lock sends nothing; approving sends one decide and the engine gets approval_result", async ({ page }) => {
  const w = await watch(page);
  const { engine } = await openHomeWith(page);
  const posted = await engine.postApproval("add_folder", [FOLDER]);
  expect(posted.status).toBe(201);
  await wake(page);
  await expect(page.getByText("승인을 기다리는 요청이 1개 있어요")).toBeVisible();
  await page.getByRole("button", { name: "보기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "폴더 추가" })).toBeVisible();
  await expect(page.getByText("새 폴더")).toBeVisible();
  await expect(page.getByText("문서 7개")).toBeVisible();

  const approve = page.getByRole("button", { name: "허락하기" });
  await expect(approve).toBeEnabled();
  // the person dismisses the device-lock prompt: get() rejects with NotAllowedError
  await page.evaluate(() => {
    const creds = navigator.credentials;
    (window as unknown as { __get: unknown }).__get = creds.get.bind(creds);
    creds.get = () => Promise.reject(new DOMException("dismissed", "NotAllowedError"));
  });
  await approve.click();
  await expect(page.getByRole("alert").filter({ hasText: "기기 잠금 확인이 안 됐어요" })).toBeVisible();
  expect(w.requests.filter((r) => r.url.endsWith("/decide"))).toHaveLength(0);

  await page.evaluate(() => { navigator.credentials.get = (window as unknown as { __get: typeof navigator.credentials.get }).__get; });
  await expect(approve).toBeEnabled();
  const decided = page.waitForResponse((r) => r.url().endsWith(`/v1/approvals/${posted.approvalId}/decide`));
  await approve.click();
  const res = await decided;
  expect(res.status(), await res.text()).toBe(200);
  expect(w.requests.filter((r) => r.url.endsWith("/decide"))).toHaveLength(1);
  await expect(page.getByText("기다리는 요청이 없어요")).toBeVisible();
  const msgs = await engine.readInbox([posted.approvalId]);
  expect(msgs.map((m) => m.body)).toEqual([expect.objectContaining({ type: "approval_result", approval_id: posted.approvalId, decision: "approved" })]);
});

test("pause stops the engine's writes (423); resume with the device lock lets them through", async ({ page }) => {
  const { engine } = await openHomeWith(page);
  await openSettings(page);
  await page.getByRole("button", { name: "잠시 멈추기" }).click();
  await expect(page.getByText("잠시 멈춰 둔 상태예요")).toBeVisible();
  expect((await engine.postApproval("add_folder", [FOLDER])).status).toBe(423);
  const resume = page.getByRole("button", { name: "다시 켜기" });
  await expect(resume).toBeEnabled();
  await resume.click();
  await expect(page.getByText("잘 돌고 있어요")).toBeVisible();
  expect((await engine.postApproval("add_folder", [FOLDER])).status).toBe(201);
});

test("disconnect: the engine's key stops working, the row says 끊김, earlier records still verify after re-opening", async ({ page }) => {
  const { engine } = await openHomeWith(page);
  expect(await engine.probe()).toBe(200);
  await openSettings(page);
  await page.getByRole("button", { name: "연결 끊기" }).click();
  await expect(page.getByText("다른 컴퓨터에서 연결할 때까지 대시보드는 보기만 돼요", { exact: true }).first()).toBeVisible();
  const confirm = page.getByRole("button", { name: "끊기", exact: true });
  await expect(confirm).toBeEnabled();
  const revoked = page.waitForResponse((r) => r.url().endsWith("/revoke") && r.status() === 200);
  await confirm.click();
  await revoked;
  await expect(page.getByText("끊김", { exact: true })).toBeVisible();
  expect([401, 403]).toContain(await engine.probe());

  await page.getByRole("button", { name: "돌아가기" }).click();
  await page.getByRole("button", { name: "지금 잠그기" }).click();
  await page.getByRole("button", { name: "이 기기로 열기" }).click();
  await expect(page.getByText(/^기록 사슬 정상 · 마지막 확인/)).toBeVisible();
  await expect(page.getByText("기록이 빠졌을 수 있어요", { exact: false })).toHaveCount(0);
  await expect(page.getByText("3개", { exact: true })).toBeVisible();
});

test("auto-lock minutes are saved and come back after locking", async ({ page }) => {
  await openHomeWith(page);
  await openSettings(page);
  const saved = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().endsWith("/v1/prefs") && r.status() === 200);
  await page.getByRole("button", { name: "1분", exact: true }).click();
  await saved;
  await expect(page.getByRole("button", { name: "1분", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "돌아가기" }).click();
  await page.getByRole("button", { name: "지금 잠그기" }).click();
  await page.getByRole("button", { name: "이 기기로 열기" }).click();
  await expect(page.getByText(/^기록 사슬 정상/)).toBeVisible();
  await openSettings(page);
  await expect(page.getByRole("button", { name: "1분", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "5분", exact: true })).toHaveAttribute("aria-pressed", "false");
});

async function makeRecoveryKey(page: Page, label: "만들기" | "다시 만들기"): Promise<string> {
  await page.getByRole("button", { name: label, exact: true }).click();
  const display = ((await page.getByTestId("settings-recovery-key").textContent()) ?? "").trim();
  await page.getByRole("button", { name: "다 보관했어요" }).click();
  await page.getByLabel("앞 4자리").fill(display.slice(0, 4));
  const save = page.getByRole("button", { name: "확인하고 저장" });
  await expect(save).toBeEnabled();
  const saved = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().endsWith("/v1/envelopes") && r.status() === 200);
  await save.click();
  await saved;
  await expect(page.getByRole("button", { name: "다시 만들기", exact: true })).toBeVisible();
  return display;
}

test("re-making the recovery key retires the old one", async ({ page }) => {
  await openHomeWith(page);
  await openSettings(page);
  const lookup = async (display: string) => (await page.request.post(`${API}/v1/recovery/envelope`, {
    headers: { origin: APP }, data: { lookup_id: recoveryLookupId(parseRecoveryKey(display)) } })).status();
  const first = await makeRecoveryKey(page, "만들기");
  expect(await lookup(first)).toBe(200);
  const second = await makeRecoveryKey(page, "다시 만들기");
  expect(second).not.toBe(first);
  expect(await lookup(first)).toBe(404);
  expect(await lookup(second)).toBe(200);
  expect(toB64u(parseRecoveryKey(second)).length).toBeGreaterThan(0);
});

test("devices: one device lock → no [이 기기 빼기]; it is marked as this device", async ({ page }) => {
  await openHomeWith(page);
  await openSettings(page);
  await expect(page.getByRole("heading", { name: "기기 목록" })).toBeVisible();
  await expect(page.getByText("이 기기", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "이 기기 빼기" })).toHaveCount(0);
});

test("deleting the account: the table, the device lock, then the lock screen — and opening fails afterwards", async ({ page }) => {
  await openHomeWith(page);
  await openSettings(page);
  await expect(page.getByRole("rowheader", { name: "지워지는 것" })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "남는 것" })).toBeVisible();
  await expect(page.getByText("증명 묶음을 따로 보관해 두세요", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "계정 지우기", exact: true }).click();
  const yes = page.getByRole("button", { name: "계정 지우기", exact: true });
  await expect(yes).toBeEnabled();
  const deleted = page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().endsWith("/v1/account") && r.status() === 200);
  await yes.click();
  await deleted;
  await expect(page.getByText("계정을 지웠어요. 이 기기에 남은 열쇠도 지웠어요")).toBeVisible();
  const open = page.getByRole("button", { name: "이 기기로 열기" });
  await expect(open).toBeEnabled();
  await open.click();
  await expect(page.getByText("이 기기는 아직 등록 안 됐어요", { exact: false })).toBeVisible();
});
