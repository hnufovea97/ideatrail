import { expect, test } from "@playwright/test";
import { BUDGET, OPEN, PIANO, SWAP, deviceView, openHome } from "./helpers/home";
import { expectClean, watch } from "./helpers/guards";

test.use({ timezoneId: "Asia/Seoul", viewport: { width: 1280, height: 900 } });

const cards = (page: import("@playwright/test").Page) => page.locator(".cards .card");
const names = (page: import("@playwright/test").Page) => page.locator(".cards .card-name").allInnerTexts();

test("server view is on first: names, stages and tags blurred; dates and blockchain state sharp (ADR-0018)", async ({ page }) => {
  const w = await watch(page);
  await openHome(page);
  await expect(page.getByLabel("Ideatrail 서버가 가진 데이터")).toBeChecked();
  await expect(page.locator(".server-toggle .mark")).toBeVisible(); // the red hand-drawn circle
  await expect(page.getByText(/^선명한 글자는 Ideatrail이 보관하는 데이터예요/)).toBeVisible();
  const first = cards(page).first();
  await expect(first.getByTestId("locked").first()).toHaveClass(/blur/);
  await expect(first.getByTestId("locked").first()).toHaveAttribute("aria-hidden", "true");
  await expect(first.getByText("최초 기록 26.09.03 / 마지막 기록 26.11.18")).toBeVisible();
  await expect(first.locator(".pill")).toHaveText("블록체인 진행 중");
  await expect(page.locator(".home .locked:not(.blur)")).toHaveCount(0);
  await expectClean(page, w);
});

test("device view: the home matches the approved prototype shape", async ({ page }) => {
  await openHome(page);
  await deviceView(page);
  await expect(page.getByText(/^지금은 이 기기에서 풀어 본 모습이에요/)).toBeVisible();
  await expect(page.getByRole("region", { name: "아이디어 목록" })).toMatchAriaSnapshot(`
    - group "보기":
      - button "전체" [pressed]
      - button "공유 가능"
      - button "나만 보기"
    - searchbox "태그나 단계로 찾기"
    - status: 3개
    - combobox "정렬":
      - option "처음 기록한 순 (오래된 것부터)" [selected]
      - option "처음 기록한 순 (최신부터)"
      - option "마지막 기록 순"
      - option "진행 단계 순"
      - option "최근 열어 본 순 (이 기기에만 저장)"
    - 'button "공정 가계부 앱 나만 보기 4/5 개발 중 최초 기록 26.09.03 / 마지막 기록 26.11.18 #기획 #협의 블록체인 진행 중"'
    - 'button "동네 중고 교환 5/5 MVP 완료 최초 기록 26.09.20 / 마지막 기록 26.10.28 #아이디어 블록체인 확산됨"'
    - 'button "피아노 연습 기록기 나만 보기 1/5 착상 최초 기록 26.10.08 / 마지막 기록 26.10.08 #취미 블록체인 진행 중"'
  `);
  await expect(page).toHaveScreenshot("home-1280.png", { fullPage: true, animations: "disabled", mask: [page.locator(".chain-line")] });
});

test("tabs, #tag search and sorts; the sort and the opening order stay on this device", async ({ page }) => {
  await openHome(page);
  await deviceView(page);
  expect(await names(page)).toEqual([BUDGET, SWAP, PIANO]); // 처음 기록한 순, oldest first
  await page.getByRole("button", { name: "공유 가능" }).click();
  expect(await names(page)).toEqual([SWAP]);
  await page.getByRole("button", { name: "나만 보기" }).click();
  expect(await names(page)).toEqual([BUDGET, PIANO]);
  await page.getByRole("button", { name: "전체" }).click();
  await page.getByRole("searchbox").fill("#기획");
  expect(await names(page)).toEqual([BUDGET]);
  await page.getByRole("searchbox").fill("MVP 완료");
  expect(await names(page)).toEqual([SWAP]);
  await page.getByRole("searchbox").fill("#없는태그");
  await expect(page.getByText("찾는 기록이 없어요. 다른 태그나 단계로 찾아보세요.")).toBeVisible();
  await page.getByRole("searchbox").fill("");
  await page.getByRole("combobox", { name: "정렬" }).selectOption({ label: "진행 단계 순" });
  expect(await names(page)).toEqual([SWAP, BUDGET, PIANO]);
  await page.getByRole("combobox", { name: "정렬" }).selectOption({ label: "마지막 기록 순" });
  expect(await names(page)).toEqual([BUDGET, SWAP, PIANO]);
  await cards(page).filter({ hasText: PIANO }).click();
  await cards(page).filter({ hasText: SWAP }).click();
  await page.getByRole("combobox", { name: "정렬" }).selectOption({ label: "최근 열어 본 순 (이 기기에만 저장)" });
  expect(await names(page)).toEqual([SWAP, PIANO, BUDGET]);
  const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("it.home.")).sort());
  expect(stored.map((k) => k.split(".")[2])).toEqual(["opened", "sort"]);
  await page.getByRole("button", { name: "지금 잠그기" }).click();
  await page.getByRole("button", { name: OPEN }).click();
  await expect(page.getByRole("combobox", { name: "정렬" })).toHaveValue("opened");
});
