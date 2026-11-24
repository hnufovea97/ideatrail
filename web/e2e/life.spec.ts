import { expect, test, type Page } from "@playwright/test";
import { BUDGET, PIANO, deviceView, openHome, proofRepos } from "./helpers/home";

test.use({ timezoneId: "Asia/Seoul", viewport: { width: 1280, height: 900 } });

async function openIdea(page: Page, title: string) {
  await openHome(page);
  await deviceView(page);
  await page.locator(".cards .card").filter({ hasText: title }).click();
  await expect(page.getByRole("heading", { name: new RegExp(title) })).toBeVisible();
}

test("stages with dates, the stage panel with 결정·미룸·변곡점 and version rows (ADR-0018·0019)", async ({ page }) => {
  await openIdea(page, BUDGET);
  const life = page.locator(".life");
  await expect(life.getByText("나만 보기 · 버전 3개")).toBeVisible();
  await expect(life.locator(".life-counts")).toHaveText(/결정 3.*미룸 1.*AI가 센 수/);
  await expect(life.locator(".date")).toHaveText(["최초 기록26.09.03", "마지막 기록26.11.18"]);
  const stages = life.getByRole("group", { name: "단계 4/5" }).getByRole("button");
  await expect(stages).toHaveCount(5);
  await expect(stages.nth(3)).toHaveAttribute("aria-pressed", "true"); // opens on the current stage
  await stages.nth(2).click(); // 기획 확정
  const panel = life.locator(".panel");
  await expect(panel.getByText("기획 확정", { exact: true })).toBeVisible();
  await expect(panel.locator(".chip")).toHaveText(["결정 2", "미룸 1", "변곡점 · 카드 연동 빼기"]);
  await expect(panel.getByText("AI가 센 수")).toBeVisible();
  const row = panel.locator(".ver");
  await expect(row).toHaveCount(1);
  await expect(row.locator(".ver-when")).toHaveText("10.02");
  await expect(row.locator(".ver-what")).toContainText("초안");
  await expect(row.locator(".ver-file")).toHaveText("원래 위치: 기획-초안.md");
  await expect(row.locator(".fp")).toHaveText(/^[0-9a-f]{3}…[0-9a-f]{3}$/);
  await expect(row.locator(".pill")).toHaveText("블록체인 진행 중");
  await stages.nth(4).click();
  await expect(panel).toHaveText("아직 이 단계에 오지 않았어요");
});

test("routine card: next slot stands out, 피드백 folds as 해당 없음, turning it off hides card and stopped days", async ({ page }) => {
  await openIdea(page, BUDGET);
  const card = page.locator(".routine");
  await expect(card.getByRole("heading")).toHaveText("루틴 점검 7개 중 3개");
  await expect(card.locator("[aria-current=step]")).toContainText("하지 않을 것 정하기");
  await expect(card.locator(".slot.yes")).toHaveCount(3);
  await expect(card.getByText("AI 추정")).toHaveCount(1);
  await card.getByRole("button", { name: "이 아이디어엔 해당 없음" }).click();
  await expect(card.getByRole("heading")).toHaveText("루틴 점검 5개 중 3개");
  await expect(card.getByText("피드백", { exact: true })).toHaveCount(0);
  await card.getByRole("button", { name: "피드백 칸 다시 펼치기" }).click();
  await expect(card.getByRole("heading")).toHaveText("루틴 점검 7개 중 3개");

  await page.locator(".cards .card").filter({ hasText: PIANO }).click(); // one record on 10.08: long in 착상
  await expect(page.locator(".stg-name").first()).toHaveText(/착상 \d+일째/);
  await page.getByRole("button", { name: "점검 숨기기" }).click();
  await expect(page.locator(".routine")).toHaveCount(0);
  await expect(page.locator(".stg-name").first()).toHaveText("착상");
  await expect(page.getByText("꺼도 점검은 조용히 쌓여요. 다시 켜면 그대로 보여요.")).toBeVisible();
  await page.getByRole("button", { name: "루틴 점검 보기" }).click();
  await expect(page.locator(".routine")).toBeVisible();
});

test("no score, grade or percent anywhere on the home or idea life (CLAUDE.md rule 8)", async ({ page }) => {
  await openIdea(page, BUDGET);
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/점수|등급|%/);
});

test("a version row opens to a GitHub-not-linked notice with a connect button; the server's view never opens it (5.13)", async ({ page }) => {
  await openHome(page);
  await page.locator(".cards .card").first().click();
  await expect(page.getByRole("button", { name: "원문 보기" })).toHaveCount(0); // server view is on at first
  await deviceView(page);
  await page.locator(".cards .card").filter({ hasText: BUDGET }).click();
  const row = page.locator(".ver").first();
  await row.getByRole("button", { name: "원문 보기" }).click();
  await expect(row.getByText("원문은 GitHub 증명 보관함을 만든 뒤에 볼 수 있어요")).toBeVisible();
  await expect(row.getByRole("button", { name: "GitHub에 보관함 만들기" })).toBeVisible();
  await row.getByRole("button", { name: "접기" }).click();
  await expect(row.getByText("원문은 GitHub 증명 보관함을 만든 뒤에 볼 수 있어요")).toHaveCount(0);
});

test("[GitHub에 보관함 만들기] on a version asks the engine, and once linked the row looks in the repo again (5.13)", async ({ page }) => {
  const engine = await openHome(page);
  const asked: string[] = [];
  await page.route("https://api.github.com/**", (route) => { asked.push(route.request().url()); return route.fulfill({ status: 404, json: {} }); });
  await deviceView(page);
  await page.locator(".cards .card").filter({ hasText: BUDGET }).click();
  const row = page.locator(".ver").first();
  await row.getByRole("button", { name: "원문 보기" }).click();
  await row.getByRole("button", { name: "GitHub에 보관함 만들기" }).click();
  await expect(row.getByRole("status")).toContainText("GitHub 화면에서 코드를");
  expect((await engine.readInbox()).map((m) => m.body.type)).toEqual(["connect_github"]);
  expect(asked).toEqual([]);
  await engine.putStorageLink();
  await expect(row.getByText("아직 GitHub에 올라가는 중이에요. 잠시 뒤에 다시 열어 보세요")).toBeVisible();
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every((u) => u.includes("/contents/proofs/"))).toBe(true);
});

test("linked: the original is opened from GitHub, checked against the signed fingerprint, and compared line by line with the version before (5.6)", async ({ page }) => {
  const engine = await openHome(page);
  const sent: string[] = [];
  page.on("request", (r) => { if (r.method() !== "GET" && r.method() !== "OPTIONS") sent.push(r.postData() ?? ""); });
  await page.route("https://api.github.com/**", (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/repos\/[^/]+\/[^/]+\/contents\//, ""));
    const bytes = proofRepos.get(page)?.[path];
    return bytes ? route.fulfill({ status: 200, body: Buffer.from(bytes) }) : route.fulfill({ status: 404, json: {} });
  });
  await engine.putStorageLink();
  const pulled = page.waitForResponse((r) => r.url().includes("/v1/sync"));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); // do not wait for the timer: pull the new link now
  await pulled;
  await deviceView(page);
  await page.locator(".cards .card").filter({ hasText: BUDGET }).click();
  await page.getByRole("group", { name: "단계 4/5" }).getByRole("button").nth(2).click(); // 기획 확정: the 초안 version
  const row = page.locator(".ver").first();
  await row.getByRole("button", { name: "원문 보기" }).click();
  await expect(row.getByText("✓ 그날 그대로예요")).toBeVisible();
  await expect(row.getByText("바로 앞 버전과 달라진 줄")).toBeVisible();
  await expect(row.locator(".dl.del")).toHaveText("− - 카드 연동\n");
  await expect(row.locator(".dl.add")).toHaveText("+ - 부부가 같이 쓴다\n");
  await expect(row.locator(".dl.same")).toHaveCount(2);
  expect(sent.join("\n")).not.toContain("월급날"); // the opened text never goes anywhere
});
