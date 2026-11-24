import { expect, test } from "@playwright/test";
import { toB64u, toHex } from "@ideatrail/crypto/bytes";
import { parseRecoveryKey } from "@ideatrail/crypto/recovery";
import { addAuthenticator } from "./helpers/authenticator";
import { makeRecoveryKey, openHomeWith, seedIdeas } from "./helpers/home";
import { APP, watch } from "./helpers/guards";

test("a lost device: the recovery key opens a new device lock, which then opens the vault; the key goes nowhere", async ({ page, browser }) => {
  const { engine } = await openHomeWith(page);
  await page.getByRole("button", { name: "설정", exact: true }).click();
  const key = await makeRecoveryKey(page, "만들기");

  // a different computer: new browser profile, a fresh virtual authenticator, none of the old device locks
  const fresh = await browser.newContext({ locale: "ko-KR" });
  try {
    const lost = await fresh.newPage();
    const w = await watch(lost);
    const auth = await addAuthenticator(lost, { prf: true });
    await seedIdeas(lost, engine);
    await lost.goto(`${APP}/home`);
    await lost.getByRole("button", { name: "비상 열쇠로 열기" }).click();
    const input = lost.getByLabel("비상 열쇠", { exact: true });
    const alert = lost.getByRole("alert").filter({ hasText: /\S/ });

    // one wrong character: no account is found, nothing is registered
    const wrong = (key[0] === "A" ? "B" : "A") + key.slice(1);
    await input.fill(wrong);
    await lost.getByRole("button", { name: "열기", exact: true }).click();
    await expect(alert).toHaveText("이 비상 열쇠로 찾은 계정이 없어요. 한 글자씩 다시 확인해 주세요");
    expect(w.requests.filter((r) => r.url.includes("/webauthn/register"))).toHaveLength(0);
    expect(await auth.count()).toBe(0);

    // too short: caught in the browser with no request at all
    const before = w.requests.length;
    await input.fill(key.slice(0, 20));
    await lost.getByRole("button", { name: "열기", exact: true }).click();
    await expect(alert).toHaveText("비상 열쇠는 52글자예요. 빠진 글자가 없는지 확인해 주세요");
    expect(w.requests.length).toBe(before);

    // the right key, typed with spaces and lower case
    const typed = key.toLowerCase().replace(/-/g, " ");
    await input.fill(typed);
    await lost.getByRole("button", { name: "열기", exact: true }).click();
    await lost.getByRole("button", { name: "기기 잠금 만들기" }).click();
    await expect(lost.getByText("기기 잠금을 만들었어요.", { exact: false })).toBeVisible();
    expect(await auth.count()).toBe(1);

    // the normal lock screen now opens the vault with the NEW device lock
    await lost.getByRole("button", { name: "이 기기로 열기" }).click();
    await expect(lost.getByText(/^기록 사슬 정상 · 마지막 확인/)).toBeVisible();
    await expect(lost.getByText("3개", { exact: true })).toBeVisible();
    await lost.getByRole("button", { name: "지금 잠그기" }).click();
    await lost.getByRole("button", { name: "이 기기로 열기" }).click();
    await expect(lost.getByText("3개", { exact: true })).toBeVisible();

    // the key, in any form, never appeared in a URL or a body
    const rk = parseRecoveryKey(key);
    const forms = [key, key.toLowerCase(), key.replace(/-/g, ""), key.replace(/-/g, "").toLowerCase(), typed, typed.replace(/ /g, ""), toHex(rk), toB64u(rk), encodeURIComponent(typed)];
    for (const r of w.requests) for (const f of forms) expect(`${r.url} ${r.body}`).not.toContain(f);
    const lookup = w.requests.find((r) => r.url.endsWith("/v1/recovery/envelope"));
    expect(JSON.parse(lookup!.body)).toEqual({ lookup_id: expect.stringMatching(/^[0-9a-f]{32}$/) });
  } finally {
    await fresh.close();
  }
});
