import { expect, test, type Page } from "@playwright/test";
import { expectClean, watch } from "./helpers/guards";
import { openSignup, passStepOne } from "./helpers/flow";

test("PRF authenticator: account confirmed, engine receives the account key, list v1", async ({ page }) => {
  const w = await watch(page);
  const { engine } = await openSignup(page, { prf: true });
  await expect(page.getByText("연결할 컴퓨터: Steven-Air")).toBeVisible();
  await passStepOne(page, engine);
  expect(engine.accountPub?.length).toBe(32);
  await expect(page.getByText("2/5")).toBeVisible();
  const verify = w.requests.find((r) => r.url.endsWith("/v1/webauthn/register/verify"));
  expect(JSON.parse(verify!.body).response.clientExtensionResults).toEqual({});
  expect(w.requests.filter((r) => r.body.includes('"prf"'))).toEqual([]); // no PRF extension output in any body
  const deliver = w.requests.find((r) => r.url.endsWith("/deliver"));
  expect(JSON.parse(deliver!.body).engine_list_version).toBe(1);
  expect(w.requests.map((r) => new URL(r.url).pathname).filter((p) => p.startsWith("/v1/")).slice(0, 6)).toEqual([
    `/v1/pairing/${engine.sessionId}`, "/v1/webauthn/register/options", "/v1/webauthn/register/verify", "/v1/account/confirm", "/v1/account", `/v1/pairing/${engine.sessionId}/deliver`,
  ]);
  await expectClean(page, w);
});

test("no PRF on create or get: nothing registered on the server, guide to another browser", async ({ page, request }) => {
  const w = await watch(page);
  const { engine } = await openSignup(page, { prf: false });
  await page.getByRole("button", { name: "시작하기", exact: true }).click();
  await page.getByRole("button", { name: "이 컴퓨터로 시작하기" }).click();
  await page.getByRole("button", { name: "확인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "이 브라우저에선 내용을 풀 수 없어요. Chrome(Google 계정 패스키)이나 Safari 최신 버전으로 열어 주세요" })).toBeVisible();
  expect(w.requests.filter((r) => r.url.endsWith("/register/verify") || r.url.endsWith("/account/confirm"))).toEqual([]);
  const pairing = await (await request.get(`http://localhost:8787/v1/pairing/${engine.sessionId}`)).json();
  expect(pairing.delivered).toBe(false);
  await expect(page.getByRole("button", { name: "링크 복사" })).toBeVisible();
});

const UNSURE = "연결을 확인하고 다시 해 주세요";

async function startStepOne(page: Page) {
  await page.getByRole("button", { name: "시작하기", exact: true }).click();
  await page.getByRole("button", { name: "이 컴퓨터로 시작하기" }).click();
  const again = page.getByRole("button", { name: "확인", exact: true });
  const unsure = page.getByText(UNSURE);
  await expect(unsure.or(again)).toBeVisible();
  if (await again.isVisible()) await again.click();
  await expect(unsure).toBeVisible();
}

test("register/verify never answered (offline): passkey kept, [다시] sends the same body and goes on", async ({ page }) => {
  const w = await watch(page);
  const { engine, auth } = await openSignup(page, { prf: true });
  let dropped = false;
  await page.route("**/v1/webauthn/register/verify", (route) => {
    if (dropped) return route.fallback();
    dropped = true;
    return route.abort("internetdisconnected");
  });
  await startStepOne(page);
  expect(await auth.count()).toBe(1);
  await page.getByRole("button", { name: "다시", exact: true }).click();
  await expect(page.getByRole("heading", { name: "휴대폰도 같이 등록" })).toBeVisible();
  await engine.takeHandoff();
  const verifies = w.requests.filter((r) => r.url.endsWith("/v1/webauthn/register/verify"));
  expect(verifies).toHaveLength(2);
  expect(verifies[1].body).toBe(verifies[0].body);
  expect(await auth.count()).toBe(1);
});

test("register/verify stored but the answer was a 5xx: the retry's refusal never forgets the passkey", async ({ page }) => {
  const { auth } = await openSignup(page, { prf: true });
  let first = true;
  await page.route("**/v1/webauthn/register/verify", async (route) => {
    if (!first) return route.fallback();
    first = false;
    await route.fetch(); // the server stores it …
    await route.fulfill({ status: 503, json: { error: { code: "unavailable" } } }); // … but the answer is lost
  });
  await startStepOne(page);
  await page.getByRole("button", { name: "다시", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("잠시 문제가 생겼어요. 다시 해 볼까요?");
  expect(await auth.count()).toBe(1);
});
