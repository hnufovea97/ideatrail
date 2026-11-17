import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toB64u, toHex } from "@ideatrail/crypto/bytes";
import { newId } from "@ideatrail/crypto/ids";
import { browser, fakeLimiter, RP, sealedB64u, signUp } from "./browser";
import { createAuthenticator } from "./authenticator";

type Json = Record<string, unknown> & { error?: { code: string } };
const json = async (r: Response) => (await r.json()) as Json;
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));

async function confirmedUser() {
  const s = await signUp();
  await s.b.call("POST", "/v1/account/confirm", {});
  return s;
}

/** PC creates the link, new device joins, PC uploads the key. */
async function linkReady() {
  const pc = await confirmedUser();
  const d = (await json(await pc.b.call("POST", "/v1/device-add", {}))).session_id as string;
  const phone = browser();
  const join = await json(await phone.call("POST", `/v1/device-add/${d}/join`, { t_pub: toB64u(rand(32)), mac: toHex(rand(32)) }));
  const seen = await json(await pc.b.call("GET", `/v1/device-add/${d}`));
  expect(seen.joined).toBe(true);
  expect((await pc.b.call("POST", `/v1/device-add/${d}/key`, { sealed_mk: sealedB64u(9, 80), mac: toHex(rand(32)) })).status).toBe(200);
  return { pc, d, phone, secret: join.join_secret as string };
}

async function registerPhone(phone: ReturnType<typeof browser>, d: string, secret: string) {
  const auth = await createAuthenticator(RP);
  const o = await phone.call("POST", "/v1/webauthn/register/options", { device_add_session_id: d, join_secret: secret });
  if (o.status !== 200) return o;
  const body = await json(o);
  return phone.call("POST", "/v1/webauthn/register/verify", {
    challenge_id: body.challenge_id, response: await auth.register(body.options as { challenge: string }),
    envelope: { envelope_id: newId(), wrapped_master_key: sealedB64u(0x80, 72) },
  });
}

describe("device add (2.7)", () => {
  afterEach(() => vi.useRealTimers());

  it("full flow adds a credential and envelope to the same account, without a new users row", async () => {
    const { pc, d, phone, secret } = await linkReady();
    const key = await phone.app.request(`https://api.test/v1/device-add/${d}/key`, { headers: { "x-it-join-secret": secret } }, env);
    expect(key.status).toBe(200);
    expect((await json(key)).user_id).toBe(pc.userId);
    const usersBefore = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first("n");
    const r = await registerPhone(phone, d, secret);
    expect(r.status).toBe(200);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first("n")).toBe(usersBefore);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM passkey_credentials WHERE user_id = ?").bind(pc.userId).first("n")).toBe(2);
    expect((await json(await phone.call("GET", "/v1/account"))).user_id).toBe(pc.userId);
  });

  it("knowing only the link id is not enough to attach a passkey", async () => {
    const { d } = await linkReady();
    const attacker = browser();
    expect((await registerPhone(attacker, d, "wrong-secret")).status).toBe(403);
    const key = await attacker.app.request(`https://api.test/v1/device-add/${d}/key`, {}, env);
    expect(key.status).toBe(403);
  });

  it("cannot register before the PC uploaded the key", async () => {
    const pc = await confirmedUser();
    const d = (await json(await pc.b.call("POST", "/v1/device-add", {}))).session_id as string;
    const phone = browser();
    const { join_secret } = await json(await phone.call("POST", `/v1/device-add/${d}/join`, { t_pub: toB64u(rand(32)), mac: toHex(rand(32)) }));
    expect((await registerPhone(phone, d, join_secret as string)).status).toBe(409);
  });

  it("the link registers one device only", async () => {
    const { d, phone, secret } = await linkReady();
    expect((await registerPhone(phone, d, secret)).status).toBe(200);
    expect((await registerPhone(browser(), d, secret)).status).toBe(409);
  });

  it("join after 2 minutes → 410; a second join → 409", async () => {
    const pc = await confirmedUser();
    const d = (await json(await pc.b.call("POST", "/v1/device-add", {}))).session_id as string;
    expect((await browser().call("POST", `/v1/device-add/${d}/join`, { t_pub: toB64u(rand(32)), mac: toHex(rand(32)) })).status).toBe(200);
    expect((await browser().call("POST", `/v1/device-add/${d}/join`, { t_pub: toB64u(rand(32)), mac: toHex(rand(32)) })).status).toBe(409);
    const d2 = (await json(await pc.b.call("POST", "/v1/device-add", {}))).session_id as string;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 121 * 1000);
    expect((await browser().call("POST", `/v1/device-add/${d2}/join`, { t_pub: toB64u(rand(32)), mac: toHex(rand(32)) })).status).toBe(410);
  });

  it("another account cannot upload the key or read the join data", async () => {
    const pc = await confirmedUser();
    const d = (await json(await pc.b.call("POST", "/v1/device-add", {}))).session_id as string;
    await browser().call("POST", `/v1/device-add/${d}/join`, { t_pub: toB64u(rand(32)), mac: toHex(rand(32)) });
    const other = await confirmedUser();
    expect((await other.b.call("POST", `/v1/device-add/${d}/key`, { sealed_mk: sealedB64u(9, 80), mac: toHex(rand(32)) })).status).toBe(403);
    expect((await other.b.call("GET", `/v1/device-add/${d}`)).status).toBe(404);
  });

  it("join is IP-rate-limited", async () => {
    const pc = await confirmedUser();
    const limiter = fakeLimiter(1);
    const d = (await json(await pc.b.call("POST", "/v1/device-add", {}))).session_id as string;
    const b = browser({ limiter });
    expect((await b.call("POST", `/v1/device-add/${d}/join`, { t_pub: toB64u(rand(32)), mac: toHex(rand(32)) })).status).toBe(200);
    expect((await b.call("POST", `/v1/device-add/${d}/join`, { t_pub: toB64u(rand(32)), mac: toHex(rand(32)) })).status).toBe(429);
  });
});
