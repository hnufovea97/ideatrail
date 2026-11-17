import { expect, type Page } from "@playwright/test";
import { addAuthenticator, type VirtualAuthenticator } from "./authenticator";
import { FakeEngine } from "./fake-engine";

export async function openSignup(page: Page, opts: { prf?: boolean; name?: string } = {}): Promise<{ engine: FakeEngine; auth: VirtualAuthenticator; link: string }> {
  const auth = await addAuthenticator(page, { prf: opts.prf ?? true });
  const engine = new FakeEngine(opts.name ?? "Steven-Air");
  const link = await engine.start();
  await page.goto(link);
  return { engine, auth, link };
}

/** Some authenticators return PRF only on get: then the page asks for one more confirmation. */
export async function confirmPasskey(page: Page, next: string) {
  const again = page.getByRole("button", { name: "확인", exact: true });
  const nextHeading = page.getByRole("heading", { name: next });
  await expect(nextHeading.or(again)).toBeVisible();
  if (await again.isVisible()) await again.click();
  await expect(nextHeading).toBeVisible();
}

/** Step 0 → step 1 done; the fake engine then takes the handoff like the real one. */
export async function passStepOne(page: Page, engine: FakeEngine) {
  await page.getByRole("button", { name: "시작하기", exact: true }).click();
  await page.getByRole("button", { name: "이 컴퓨터로 시작하기" }).click();
  await confirmPasskey(page, "휴대폰도 같이 등록");
  await engine.takeHandoff();
}
export async function skipPhone(page: Page) {
  await page.getByRole("button", { name: "휴대폰이 지금 없어요" }).click();
  await expect(page.getByRole("heading", { name: "GitHub 보관" })).toBeVisible();
}

export async function githubLater(page: Page) {
  await page.getByRole("button", { name: "나중에", exact: true }).click();
  await expect(page.getByRole("heading", { name: "GitHub 보관" })).toHaveCount(0); // step 4 screen: Task 12
}
