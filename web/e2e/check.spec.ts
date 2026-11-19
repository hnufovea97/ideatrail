import { expect, test } from "@playwright/test";
import { toB64u } from "@ideatrail/crypto/bytes";
import { randomKey } from "@ideatrail/crypto/keypair";
import { FakeEngine } from "./helpers/fake-engine";
import { expectClean, watch } from "./helpers/guards";

test("shows the computer name from the link and removes the secret from the address bar", async ({ page }) => {
  const w = await watch(page);
  const engine = new FakeEngine("Steven의 MacBook Air");
  await page.goto(await engine.start());
  await expect(page.getByText("연결할 컴퓨터: Steven의 MacBook Air")).toBeVisible();
  await expect(page.getByText("Claude Code가 직접 연 링크가 아니라면 닫으세요")).toBeVisible();
  await expect(page.getByText("약 5분 걸려요", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("이거 괜찮은데?");
  await expect(page.getByRole("region", { name: "이렇게 써요" })).toContainText("기억해 줘");
  await expect(page.getByRole("region", { name: "써 보면 좋은 점" }).getByRole("listitem")).toHaveCount(3);
  const map = page.getByRole("region", { name: "안심하고 쓰는 이유: 무엇이 어디에 생기나요" });
  await expect(map.getByRole("listitem")).toHaveCount(4);
  await expect(map.getByRole("listitem").nth(0)).toContainText("열쇠이 컴퓨터");
  await expect(map.getByRole("listitem").nth(3)).toContainText("비상 열쇠종이·비밀번호 관리자");
  await expect(map).toContainText("Ideatrail 서버에는 기록 일시와 파일 지문");
  expect(new URL(page.url()).hash).toBe("");
  await expectClean(page, w);
});

test("stops when the server's engine key does not match the link fingerprint", async ({ page }) => {
  const w = await watch(page);
  const engine = new FakeEngine();
  const link = await engine.start();
  await page.route(`**/v1/pairing/${engine.sessionId}`, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, kem_pubkey: toB64u(randomKey()) } });
  });
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "이 링크는 이 컴퓨터의 설치와 맞지 않아 멈췄어요. Claude Code에서 설치 링크를 다시 받아 주세요" })).toBeVisible();
  expect(w.requests.filter((r) => r.url.includes("/v1/webauthn/"))).toEqual([]);
});

test("guides to another browser when PRF is not supported", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(PublicKeyCredential, "getClientCapabilities", { value: async () => ({ "extension:prf": false }) });
  });
  const engine = new FakeEngine();
  await page.goto(await engine.start());
  await expect(page.getByRole("heading", { name: "이 브라우저에서는 열쇠를 만들 수 없어요. Chrome이나 Safari로 열어 주세요" })).toBeVisible();
  await expect(page.getByRole("button", { name: "링크 복사" })).toBeVisible();
});

test("without a link: tells you the one line to paste into Claude Code", async ({ page }) => {
  await page.goto("/start");
  await expect(page.getByRole("heading", { name: "이 한 줄을 Claude Code에 붙여넣어 주세요: /plugin install ideatrail" })).toBeVisible();
});

test("an expired or unknown session says the link timed out", async ({ page }) => {
  const engine = new FakeEngine();
  const link = await engine.start();
  await page.goto(link.replace(engine.sessionId, "01jcm3v8q7s2kx4f9d6b5n0tqw"));
  await expect(page.getByRole("heading", { name: /이 링크는 시간이 지났어요/ })).toBeVisible();
});
