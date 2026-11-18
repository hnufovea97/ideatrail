import { expect, test } from "@playwright/test";
import { toB64u, toHex } from "@ideatrail/crypto/bytes";
import { parseRecoveryKey } from "@ideatrail/crypto/recovery";
import { githubLater, openSignup, passStepOne, saveRecoveryKey, skipPhone } from "./helpers/flow";
import { watch } from "./helpers/guards";

test("phone skipped → no [나중에]; the key and the first four never leave the browser", async ({ page }) => {
  const w = await watch(page);
  const { engine } = await openSignup(page);
  await passStepOne(page, engine);
  await skipPhone(page);
  await githubLater(page);
  await expect(page.getByRole("button", { name: "나중에", exact: true })).toHaveCount(0);
  const display = await saveRecoveryKey(page);
  const rk = parseRecoveryKey(display);
  const forms = [display, display.replace(/-/g, ""), display.toLowerCase(), display.replace(/-/g, "").toLowerCase(), toHex(rk), toB64u(rk)];
  for (const r of w.requests) for (const f of forms) expect(`${r.url} ${r.body}`).not.toContain(f);
  const four = display.slice(0, 4);
  for (const r of w.requests) for (const f of [`"${four}"`, `"${four.toLowerCase()}"`, `=${four}`, `=${four.toLowerCase()}`]) expect(`${r.url} ${r.body}`).not.toContain(f); // the typed first four is not sent
  const put = w.requests.find((r) => r.method === "PUT" && r.url.endsWith("/v1/envelopes"));
  expect(JSON.parse(put!.body).method).toBe("recovery");
});

test("a wrong first four is caught in the browser with zero requests", async ({ page }) => {
  const w = await watch(page);
  const { engine } = await openSignup(page);
  await passStepOne(page, engine);
  await skipPhone(page);
  await githubLater(page);
  await page.getByLabel("PDF로 인쇄").check();
  await page.getByRole("button", { name: "지금 만들기" }).click();
  await expect(page.getByRole("button", { name: "인쇄" })).toBeVisible();
  const prepared = page.waitForResponse((r) => r.url().endsWith("/v1/webauthn/stepup/options"));
  await page.getByRole("button", { name: "다 보관했어요" }).click();
  await prepared;
  const before = w.requests.length;
  await page.getByLabel("앞 4자리").fill("ZZZZ");
  await page.getByRole("button", { name: "확인하고 저장" }).click();
  await expect(page.getByRole("alert")).toHaveText("앞 4자리가 달라요. 보관한 비상 열쇠를 다시 확인해 주세요");
  await expect(page.getByLabel("앞 4자리")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("앞 4자리")).toHaveAttribute("aria-errormessage", "screen-error");
  expect(w.requests.length).toBe(before);
});

test("each phase inside the step moves focus to its title (choose → show → check)", async ({ page }) => {
  const { engine } = await openSignup(page);
  await passStepOne(page, engine);
  await skipPhone(page);
  await githubLater(page);
  const h1 = page.getByRole("heading", { level: 1 });
  await page.getByRole("button", { name: "지금 만들기" }).click();
  await expect(page.getByTestId("recovery-key")).toBeVisible();
  await expect(h1).toBeFocused();
  await expect(h1).toHaveAccessibleName("비상 열쇠 중요");
  const groups = page.getByTestId("recovery-key").locator('span[translate="no"][lang="en"]');
  expect(await groups.count()).toBeGreaterThan(1);
  await expect(page.getByText("4글자씩 끊어 천천히 읽어 보세요")).toBeVisible();
  await expect(page.getByText("5단계 중 4단계")).toBeAttached();
  await page.getByRole("button", { name: "다 보관했어요" }).click();
  await expect(page.getByLabel("앞 4자리")).toBeVisible();
  await expect(h1).toBeFocused();
});
