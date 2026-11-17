import { expect, test } from "@playwright/test";
import { toB64u, utf8 } from "@ideatrail/crypto/bytes";
import { newId } from "@ideatrail/crypto/ids";
import { newKemKeyPair, randomKey, signPublicKey } from "@ideatrail/crypto/keypair";
import { KIND, seal } from "@ideatrail/crypto/seal";
import { messageFor, sign } from "@ideatrail/crypto/sign";
import { FakeEngine } from "./helpers/fake-engine";
import { githubLater, openSignup, passStepOne, saveRecoveryKey, skipPhone } from "./helpers/flow";
import { watch } from "./helpers/guards";

const STOP = "이 링크는 이 컴퓨터의 설치와 맞지 않아 멈췄어요. Claude Code에서 설치 링크를 다시 받아 주세요";

for (const swap of ["sign", "kem", "both"] as const) {
  test(`server hands out other engine keys (${swap}) → stop before any passkey or account call`, async ({ page }) => {
    const w = await watch(page);
    const engine = new FakeEngine();
    const link = await engine.start();
    const fakeSign = toB64u(signPublicKey(randomKey()));
    const fakeKem = toB64u(newKemKeyPair().pub);
    await page.route(`**/v1/pairing/${engine.sessionId}`, async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      await route.fulfill({ response: res, json: { ...body, sign_pubkey: swap === "kem" ? body.sign_pubkey : fakeSign, kem_pubkey: swap === "sign" ? body.kem_pubkey : fakeKem } });
    });
    await page.goto(link);
    await expect(page.getByRole("heading", { name: STOP })).toBeVisible();
    const after = w.requests.map((r) => new URL(r.url).pathname).filter((p) => p.startsWith("/v1/") && p !== `/v1/pairing/${engine.sessionId}`);
    expect(after).toEqual([]);
  });
}

test("a folder list the server made up (sealed to the account key, not engine-signed) is never shown", async ({ page }) => {
  const { engine } = await openSignup(page);
  await passStepOne(page, engine);
  // The server knows the account public key, so it can seal a summary — but not sign as the engine.
  const id = newId();
  const summary = await seal(KIND.folder_suggestions, engine.accountPub!, { userId: engine.userId, rootId: id, version: "0" },
    utf8(JSON.stringify({ v: 1, folders: [{ path: "/Users/e2e/.ssh", name: "프로젝트", files: 3, current: true }] })));
  const sig = sign(randomKey(), messageFor({ type: "approval", userId: engine.userId, approvalId: id, kind: "signup_select", summarySealed: summary, apprSeq: 1n }));
  await page.route("**/v1/approvals", (route) => route.request().method() === "GET"
    ? route.fulfill({ json: { approvals: [{ approval_id: id, engine_id: engine.engineId, kind: "signup_select", summary: toB64u(summary), appr_seq: "1", engine_sig: sig, created_at: "x", expires_at: "y" }] } })
    : route.fallback());
  await skipPhone(page);
  await githubLater(page);
  await saveRecoveryKey(page);
  await expect(page.getByText("이 컴퓨터의 엔진이 폴더 목록을 보내고 있어요")).toBeVisible();
  await page.waitForTimeout(5_000);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});
