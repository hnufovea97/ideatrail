import { devices, expect, test, type Page } from "@playwright/test";
import { fromB64u, toB64u, toHex } from "@ideatrail/crypto/bytes";
import { randomKey } from "@ideatrail/crypto/keypair";
import { addAuthenticator } from "./helpers/authenticator";
import { confirmPasskey, openSignup, passStepOne } from "./helpers/flow";
import { API, expectClean, watch } from "./helpers/guards";

const qrUrl = (page: Page) => page.getByRole("img", { name: "휴대폰으로 찍을 QR 코드 (2분 유효)" }).getAttribute("data-url");

test("phone joins with the QR secret, registers its own passkey, PC moves on", async ({ page, browser }) => {
  const pc = await watch(page);
  const { engine } = await openSignup(page);
  await passStepOne(page, engine);
  const url = await qrUrl(page);
  const phoneCtx = await browser.newContext({ ...devices["Pixel 7"], locale: "ko-KR" });
  const phone = await phoneCtx.newPage();
  const w = await watch(phone);
  await addAuthenticator(phone, { prf: true });
  await phone.goto(url!);
  await phone.getByRole("button", { name: "이 기기 잠금으로 등록" }).click();
  await confirmPasskey(phone, "이 기기에서도 열려요 ✓");
  await expect(phone.getByText("홈 화면에 추가")).toBeVisible();
  await expect(page.getByRole("heading", { name: "GitHub 보관" })).toBeVisible();
  await expectClean(phone, w);
  // The QR secret leaves neither device: only its MACs (and the join secret) reach the API.
  const qpsk = fromB64u(new URL(url!).hash.replace(/^#v1\./, ""));
  const toApi = [...pc.requests, ...w.requests].filter((r) => new URL(r.url).origin === API);
  expect(toApi.some((r) => r.url.endsWith("/join"))).toBe(true);
  for (const r of toApi) for (const f of [toB64u(qpsk), toHex(qpsk)]) expect(`${r.url} ${r.body}`).not.toContain(f);
  await phoneCtx.close();
});

test("a device without the QR secret is refused: the PC never sends the key", async ({ page, browser }) => {
  const pc = await watch(page);
  const { engine } = await openSignup(page);
  await passStepOne(page, engine);
  const url = new URL((await qrUrl(page))!);
  url.hash = `#v1.${toB64u(randomKey())}`;
  const phoneCtx = await browser.newContext({ ...devices["Pixel 7"] });
  const phone = await phoneCtx.newPage();
  await phone.goto(url.toString());
  await expect(page.getByText("다른 기기가 먼저 연결을 시도해서 멈췄어요. 새 QR을 만들었어요")).toBeVisible();
  expect(pc.requests.filter((r) => r.method === "POST" && /\/v1\/device-add\/[^/]+\/key$/.test(r.url))).toEqual([]);
  await expect(phone.getByRole("button", { name: "이 기기 잠금으로 등록" })).toHaveCount(0);
  await phoneCtx.close();
});

test("without any fragment the phone says it is not registered and does not join", async ({ page }) => {
  const w = await watch(page);
  await page.goto("/connect?d=01jcm3v8q7s2kx4f9d6b5n0tqw");
  await expect(page.getByRole("heading", { name: "이 기기는 아직 등록 안 됐어요. 쓰던 기기에서 '기기 추가'를 눌러 주세요" })).toBeVisible();
  expect(w.requests.filter((r) => r.url.includes("/join"))).toEqual([]);
});

test("the QR is replaced after 2 minutes with nobody joining", async ({ page }) => {
  await page.clock.install();
  const { engine } = await openSignup(page);
  await passStepOne(page, engine);
  const first = await qrUrl(page);
  await page.clock.fastForward("02:01");
  await expect(page.getByText("2분이 지나서 새로 만들었어요")).toBeVisible();
  await expect.poll(() => qrUrl(page)).not.toBe(first);
});

test("QR을 찍을 수 없어요 → a one-time link to copy, never shown as text", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { engine } = await openSignup(page);
  await passStepOne(page, engine);
  const qr = page.getByRole("img", { name: /QR을 찍을 수 없어요/ });
  await expect(qr).toBeVisible();
  const url = (await qrUrl(page))!;
  await page.getByText("QR을 찍을 수 없어요", { exact: true }).click();
  await expect(page.getByText("이 링크는 한 번만 쓰는 비밀 열쇠예요. 2분 동안만 쓸 수 있고, 다른 사람에게는 절대 보내지 마세요")).toBeVisible();
  await page.getByRole("button", { name: "링크 복사 (내 휴대폰에서만 열기)" }).click();
  await expect(page.getByRole("status").filter({ hasText: "복사했어요" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  expect(await page.locator("body").innerText()).not.toContain(new URL(url).hash);
});
