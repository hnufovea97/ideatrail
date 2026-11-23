import { describe, expect, it } from "vitest";
import { toB64u } from "@ideatrail/crypto/bytes";
import { newId } from "@ideatrail/crypto/ids";
import { newKemKeyPair, randomKey } from "@ideatrail/crypto/keypair";
import { relock } from "@ideatrail/crypto/relock";
import { subkey } from "@ideatrail/crypto/subkey";
import { ApiFailure, type AccountInfo, type Api, type AssertionJSON } from "./api";
import { memoryStore, sealEngineList, type EngineList } from "./engine-list";
import { makeEnvelope } from "./signup/account";
import { isFresh, openVault, prepareLogin, settleOpened, unlockReason, wipeVault, UnlockFailure, type DashboardVault, type PreparedLogin } from "./unlock";
import { LOGIN_REFRESH_MS } from "./timing";

const RAW_ID = new Uint8Array(16).fill(1);
const prfBytes = () => new Uint8Array(32).fill(7);
const prepared: PreparedLogin = { challenge_id: "01jcm3v8q7s2kx4f9d6b5n0tqw", options: { challenge: "AAAA" }, preparedAt: 0 };

function account(version = 1) {
  const userId = newId();
  const mk = randomKey();
  const ak = newKemKeyPair();
  const list: EngineList = { v: 1, version, engines: [] };
  const info: AccountInfo = {
    user_id: userId, engine_list: sealEngineList(mk, userId, list), engine_list_version: version, confirmed_at: "2026-11-23T00:00:00Z", recovery_key_status: "set",
    account_pubkey: toB64u(ak.pub), wrapped_account_privkey: toB64u(relock(subkey(mk, "account_priv"), "account_priv", { userId }, ak.priv)), auto_lock_minutes: 5,
  };
  return { userId, mk, ak, envelope: makeEnvelope(mk, userId, prfBytes(), RAW_ID), info };
}
type Acc = ReturnType<typeof account>;

function fakeApi(a: Acc, over: { loginVerify?: () => Promise<unknown>; account?: () => Promise<AccountInfo> } = {}) {
  const calls = { verify: 0 };
  const api = {
    loginVerify: over.loginVerify ?? (async () => { calls.verify++; return { user_id: a.userId, envelope: a.envelope }; }),
    account: over.account ?? (async () => a.info),
  } as unknown as Api;
  return { api, calls };
}
const got = (prf: Uint8Array | null = prfBytes()) => ({ assertion: {} as AssertionJSON, rawId: RAW_ID, prf });
const reasonOf = (p: Promise<unknown>) => p.then(() => "opened", (e) => unlockReason(e));

describe("open the vault after the passkey (5.1)", () => {
  it("unwraps MK, checks the account key, opens the engine list and zeroes the PRF output", async () => {
    const a = account();
    const g = got();
    const store = memoryStore();
    const v = await openVault(fakeApi(a).api, prepared, g, store);
    expect(v.userId).toBe(a.userId);
    expect(v.mk).toEqual(a.mk);
    expect(v.akPub).toEqual(a.ak.pub);
    expect(v.engineList.version).toBe(1);
    expect(v.autoLockMinutes).toBe(5);
    expect(g.prf!.every((b) => b === 0)).toBe(true);
    expect(store.get(`it.elv.${a.userId}`)).toBe("1");
  });
  it("no PRF output: stops before asking the server", async () => {
    const a = account();
    const { api, calls } = fakeApi(a);
    expect(await reasonOf(openVault(api, prepared, got(null), memoryStore()))).toBe("prf_missing");
    expect(calls.verify).toBe(0);
  });
  it("refuses an account public key the server swapped", async () => {
    const a = account();
    const swapped = { ...a.info, account_pubkey: toB64u(newKemKeyPair().pub) };
    expect(await reasonOf(openVault(fakeApi(a, { account: async () => swapped }).api, prepared, got(), memoryStore()))).toBe("account_mismatch");
  });
  it("refuses an engine list older than this browser has seen", async () => {
    const a = account(1);
    const store = memoryStore();
    store.set(`it.elv.${a.userId}`, "3");
    expect(await reasonOf(openVault(fakeApi(a).api, prepared, got(), store))).toBe("engine_list_rollback");
  });
  it("an unknown passkey reads as 'not registered'; no network reads as offline", async () => {
    const a = account();
    const refused = fakeApi(a, { loginVerify: async () => { throw new ApiFailure(400, "webauthn_failed"); } }).api;
    expect(await reasonOf(openVault(refused, prepared, got(), memoryStore()))).toBe("not_registered");
    const offline = fakeApi(a, { loginVerify: async () => { throw new ApiFailure(0, "offline"); } }).api;
    expect(await reasonOf(openVault(offline, prepared, got(), memoryStore()))).toBe("offline");
  });
  it("an envelope for another device does not open (one generic reason)", async () => {
    const a = account();
    expect(await reasonOf(openVault(fakeApi(a).api, prepared, got(new Uint8Array(32).fill(8)), memoryStore()))).toBe("failed");
  });
  it("auto-lock minutes: the server may only lower the 5-minute default (1–5); anything odd is 5", async () => {
    for (const [given, want] of [[0, 1], [999, 5], [undefined, 5], [15, 5], [3, 3], [2.5, 5], ["3", 5]] as const) {
      const a = account();
      const v = await openVault(fakeApi(a, { account: async () => ({ ...a.info, auto_lock_minutes: given as number }) }).api, prepared, got(), memoryStore());
      expect(v.autoLockMinutes).toBe(want);
    }
  });
  it("wipeVault zeroes both secrets; a cancelled passkey reads as passkey_cancel", () => {
    const v = { userId: "u", mk: new Uint8Array(32).fill(1), akPriv: new Uint8Array(32).fill(2), akPub: new Uint8Array(32) };
    wipeVault(v);
    expect([...v.mk, ...v.akPriv].every((b) => b === 0)).toBe(true);
    expect(unlockReason(new DOMException("x", "NotAllowedError"))).toBe("passkey_cancel");
    expect(unlockReason(new UnlockFailure("offline"))).toBe("offline");
    expect(unlockReason(new Error("boom"))).toBe("failed");
  });

  it("only the server's unknown-passkey code is 'not registered'; a used/expired challenge or 429 asks to retry", async () => {
    const a = account();
    const failWith = (status: number, code: string) => fakeApi(a, { loginVerify: async () => { throw new ApiFailure(status, code); } }).api;
    expect(await reasonOf(openVault(failWith(400, "webauthn_failed"), prepared, got(), memoryStore()))).toBe("not_registered");
    expect(await reasonOf(openVault(failWith(400, "challenge_invalid"), prepared, got(), memoryStore()))).toBe("retry");
    expect(await reasonOf(openVault(failWith(429, "rate_limited"), prepared, got(), memoryStore()))).toBe("retry");
    expect(await reasonOf(openVault(failWith(400, "invalid_input"), prepared, got(), memoryStore()))).toBe("failed");
  });
  it("prepared login options carry their age; older than LOGIN_REFRESH_MS is stale", async () => {
    const api = { loginOptions: async () => ({ challenge_id: prepared.challenge_id, options: prepared.options }) } as unknown as Api;
    const p = await prepareLogin(api, () => 1000);
    expect(p.preparedAt).toBe(1000);
    expect(isFresh(p, 1000 + LOGIN_REFRESH_MS - 1)).toBe(true);
    expect(isFresh(p, 1000 + LOGIN_REFRESH_MS)).toBe(false);
  });
  it("a vault that opens after the lock screen went away is wiped, not handed over", () => {
    const v = { userId: "u", mk: new Uint8Array(32).fill(1), akPriv: new Uint8Array(32).fill(2), akPub: new Uint8Array(32) } as DashboardVault;
    let taken = 0;
    settleOpened(false, v, () => taken++);
    expect([taken, v.mk.every((b) => b === 0), v.akPriv.every((b) => b === 0)]).toEqual([0, true, true]);
    const w = { ...v, mk: new Uint8Array(32).fill(1) };
    settleOpened(true, w, () => taken++);
    expect([taken, w.mk[0]]).toEqual([1, 1]);
  });
});
