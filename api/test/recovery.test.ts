import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toB64u } from "@ideatrail/crypto/bytes";
import { newId } from "@ideatrail/crypto/ids";
import { lookupHash, recoveryLookupId, recoveryProof, recoveryVerifyKey } from "@ideatrail/crypto/envelope";
import { browser, fakeLimiter, RP, sealedB64u, signUp } from "./browser";
import { createAuthenticator } from "./authenticator";

type Json = Record<string, unknown> & { error?: { code: string } };
const json = async (r: Response) => (await r.json()) as Json;

async function stepup(b: ReturnType<typeof browser>, auth: Awaited<ReturnType<typeof signUp>>["auth"], method: string, path: string) {
  const o = await json(await b.call("POST", "/v1/webauthn/stepup/options", { method, path }));
  return { challenge_id: o.challenge_id as string, response: await auth.login(o.options as { challenge: string }) };
}

/** Confirmed account with a recovery envelope registered for a fresh RK. */
async function withRecovery() {
  const s = await signUp();
  await s.b.call("POST", "/v1/account/confirm", {});
  const rk = crypto.getRandomValues(new Uint8Array(32));
  const r = await s.b.call("PUT", "/v1/envelopes", {
    envelope_id: newId(), method: "recovery", wrapped_master_key: sealedB64u(0x80, 72),
    lookup_hash: lookupHash(recoveryLookupId(rk)), verify_pubkey: toB64u(recoveryVerifyKey(rk).publicKey),
    assertion: await stepup(s.b, s.auth, "PUT", "/v1/envelopes"),
  });
  expect(r.status).toBe(200);
  return { ...s, rk };
}

async function recover(rk: Uint8Array, b = browser(), proofOverride?: string) {
  const found = await b.call("POST", "/v1/recovery/envelope", { lookup_id: recoveryLookupId(rk) });
  if (found.status !== 200) return { status: found.status };
  const f = await json(found);
  const o = await b.call("POST", "/v1/webauthn/register/options", { recovery_challenge_id: f.recovery_challenge_id, proof: proofOverride ?? recoveryProof(rk, f.challenge as string) });
  if (o.status !== 200) return { status: o.status };
  const body = await json(o);
  const auth = await createAuthenticator(RP);
  const v = await b.call("POST", "/v1/webauthn/register/verify", {
    challenge_id: body.challenge_id, response: await auth.register(body.options as { challenge: string }),
    envelope: { envelope_id: newId(), wrapped_master_key: sealedB64u(0x80, 72) },
  });
  return { status: v.status, b, f };
}

describe("recovery (§11)", () => {
  afterEach(() => vi.useRealTimers());

  it("recovery envelope needs step-up", async () => {
    const s = await signUp();
    await s.b.call("POST", "/v1/account/confirm", {});
    const rk = crypto.getRandomValues(new Uint8Array(32));
    const r = await s.b.call("PUT", "/v1/envelopes", { envelope_id: newId(), method: "recovery", wrapped_master_key: sealedB64u(0x80, 72),
      lookup_hash: lookupHash(recoveryLookupId(rk)), verify_pubkey: toB64u(recoveryVerifyKey(rk).publicKey) });
    expect(r.status).toBe(401);
  });

  it("the DB keeps only the lookup hash, and the account is marked as having a recovery key", async () => {
    const { userId, rk } = await withRecovery();
    const row = await env.DB.prepare("SELECT lookup_hash FROM key_envelopes WHERE user_id = ? AND method = 'recovery'").bind(userId).first("lookup_hash");
    expect(row).toBe(lookupHash(recoveryLookupId(rk)));
    expect(JSON.stringify(await env.DB.prepare("SELECT * FROM key_envelopes WHERE user_id = ?").bind(userId).all())).not.toContain(recoveryLookupId(rk));
    expect(await env.DB.prepare("SELECT recovery_key_status FROM users WHERE user_id = ?").bind(userId).first("recovery_key_status")).toBe("created");
  });

  it("RK → envelope → proof → new passkey → signed in to the same account", async () => {
    const { userId, rk } = await withRecovery();
    const r = await recover(rk);
    expect(r.status).toBe(200);
    expect((await json(await r.b!.call("GET", "/v1/account"))).user_id).toBe(userId);
  });

  it("recovery signs out every other session of the account", async () => {
    const { b, rk } = await withRecovery();
    expect((await b.call("GET", "/v1/account")).status).toBe(200);
    expect((await recover(rk)).status).toBe(200);
    expect((await b.call("GET", "/v1/account")).status).toBe(401);
  });

  it("a bad proof does not burn the challenge", async () => {
    const { rk } = await withRecovery();
    const b = browser();
    const f = await json(await b.call("POST", "/v1/recovery/envelope", { lookup_id: recoveryLookupId(rk) }));
    expect((await b.call("POST", "/v1/webauthn/register/options", { recovery_challenge_id: f.recovery_challenge_id, proof: toB64u(new Uint8Array(64)) })).status).toBe(403);
    expect((await b.call("POST", "/v1/webauthn/register/options", { recovery_challenge_id: f.recovery_challenge_id, proof: recoveryProof(rk, f.challenge as string) })).status).toBe(200);
  });

  it("lookup_id without RK (bad proof) cannot attach a passkey", async () => {
    const { rk } = await withRecovery();
    const r = await recover(rk, browser(), toB64u(new Uint8Array(64)));
    expect(r.status).toBe(403);
  });

  it("unknown lookup_id → 404", async () => {
    expect((await recover(crypto.getRandomValues(new Uint8Array(32)))).status).toBe(404);
  });

  it("the recovery challenge expires after 5 minutes and works once", async () => {
    const { rk } = await withRecovery();
    const b = browser();
    const f = await json(await b.call("POST", "/v1/recovery/envelope", { lookup_id: recoveryLookupId(rk) }));
    const proof = recoveryProof(rk, f.challenge as string);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1000);
    expect((await b.call("POST", "/v1/webauthn/register/options", { recovery_challenge_id: f.recovery_challenge_id, proof })).status).toBe(400);
    vi.useRealTimers();
    const g = await json(await b.call("POST", "/v1/recovery/envelope", { lookup_id: recoveryLookupId(rk) }));
    const proof2 = recoveryProof(rk, g.challenge as string);
    expect((await b.call("POST", "/v1/webauthn/register/options", { recovery_challenge_id: g.recovery_challenge_id, proof: proof2 })).status).toBe(200);
    expect((await b.call("POST", "/v1/webauthn/register/options", { recovery_challenge_id: g.recovery_challenge_id, proof: proof2 })).status).toBe(400);
  });

  it("replacing the recovery envelope keeps exactly one", async () => {
    const s = await withRecovery();
    const rk2 = crypto.getRandomValues(new Uint8Array(32));
    expect((await s.b.call("PUT", "/v1/envelopes", { envelope_id: newId(), method: "recovery", wrapped_master_key: sealedB64u(0x80, 72),
      lookup_hash: lookupHash(recoveryLookupId(rk2)), verify_pubkey: toB64u(recoveryVerifyKey(rk2).publicKey),
      assertion: await stepup(s.b, s.auth, "PUT", "/v1/envelopes") })).status).toBe(200);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM key_envelopes WHERE user_id = ? AND method = 'recovery'").bind(s.userId).first("n")).toBe(1);
    expect((await recover(s.rk)).status).toBe(404);
  });

  it("recovery lookup is IP-rate-limited", async () => {
    const b = browser({ limiter: fakeLimiter(10) });
    for (let i = 0; i < 10; i++) await b.call("POST", "/v1/recovery/envelope", { lookup_id: "0".repeat(32) });
    expect((await b.call("POST", "/v1/recovery/envelope", { lookup_id: "0".repeat(32) })).status).toBe(429);
  });
});
