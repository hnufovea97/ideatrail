import { expect, test, type Page } from "@playwright/test";
import { BUDGET, OPEN, deviceView, openHome, rootSaves } from "./helpers/home";

test.use({ timezoneId: "Asia/Seoul", viewport: { width: 1280, height: 900 } });

const NAMES = ["씨앗", "구상", "시안", "다듬기", "공개"];
const PRESET = ["착상", "기획 중", "기획 확정", "개발 중", "MVP 완료"];

async function openIdea(page: Page, title: string) {
  await page.locator(".cards .card").filter({ hasText: title }).click();
  await expect(page.getByRole("heading", { name: new RegExp(title) })).toBeVisible();
}
const names = (page: Page) => page.locator(".life .stg-name");
async function fill(page: Page, values: string[]) {
  for (const [i, v] of values.entries()) await page.getByLabel(`${i + 1}번째 단계 이름`).fill(v);
}

test("rename the five stages: kept after a reload, never plain on the wire, preset one click away (ADR-0020)", async ({ page }) => {
  const posted: string[] = [];
  page.on("request", (r) => { if (r.method() !== "GET") posted.push(`${r.url()} ${r.postData() ?? ""}`); });
  await openHome(page);
  await deviceView(page);
  await openIdea(page, BUDGET);
  await expect(names(page)).toHaveText(PRESET);

  await page.getByRole("button", { name: "이름 고치기" }).click();
  await expect(page.getByRole("heading", { name: "단계 이름 고치기" })).toBeVisible();
  await expect(page.getByText("AI가 붙인 이름이에요. 언제든 바꿀 수 있어요")).toBeVisible();
  const save = page.getByRole("button", { name: "저장", exact: true });
  await fill(page, [...NAMES.slice(0, 4), "가나다라마바사아자차카타파"]); // 13 characters
  await expect(save).toBeDisabled();
  await fill(page, [...NAMES.slice(0, 4), ""]); // an empty box
  await expect(save).toBeDisabled();
  await fill(page, NAMES);
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole("heading", { name: "단계 이름 고치기" })).toHaveCount(0);
  await expect(names(page)).toHaveText(NAMES);
  expect(rootSaves.get(page)).toHaveLength(1);
  for (const n of NAMES) expect(posted.join("\n")).not.toContain(n); // only the sealed blob left the browser

  await page.reload();
  await page.getByRole("button", { name: OPEN }).click();
  await expect(page.getByText("3개", { exact: true })).toBeVisible();
  await deviceView(page);
  await openIdea(page, BUDGET);
  await expect(names(page)).toHaveText(NAMES);
  await page.locator(".cards .card").filter({ hasText: BUDGET }).getByText("다듬기").waitFor(); // the card says the same name (stage 4)

  await page.getByRole("button", { name: "이름 고치기" }).click();
  await page.getByRole("button", { name: "기본 이름으로" }).click();
  await expect(names(page)).toHaveText(PRESET);
  await page.getByRole("button", { name: "이름 고치기" }).click();
  await page.getByRole("button", { name: "취소" }).click();
  await expect(page.getByRole("heading", { name: "단계 이름 고치기" })).toHaveCount(0);
  for (const n of [...NAMES, ...PRESET]) expect(posted.join("\n")).not.toContain(n);
});

test("server view on: the names are blurred and the rename button is gone", async ({ page }) => {
  await openHome(page);
  await page.locator(".cards .card").first().click();
  await expect(page.locator(".life")).toBeVisible();
  await expect(page.getByRole("button", { name: "이름 고치기" })).toHaveCount(0);
  await expect(page.locator(".life .stg-name .locked.blur").first()).toBeVisible();
});
