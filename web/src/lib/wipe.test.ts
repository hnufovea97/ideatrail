// Temporary keys are zeroed on every path, the failing ones included (sec L3 / code L1).
import { describe, expect, it, vi } from "vitest";

const made = vi.hoisted(() => ({ subkeys: [] as Uint8Array[], unlocked: [] as Uint8Array[] }));
vi.mock("@ideatrail/crypto/subkey", async (orig) => {
  const real = await orig<typeof import("@ideatrail/crypto/subkey")>();
  return { ...real, subkey: (...a: Parameters<typeof real.subkey>) => { const k = real.subkey(...a); made.subkeys.push(k); return k; } };
});
vi.mock("@ideatrail/crypto/relock", async (orig) => {
  const real = await orig<typeof import("@ideatrail/crypto/relock")>();
  return { ...real, unlock: (...a: Parameters<typeof real.unlock>) => { const pt = real.unlock(...a); made.unlocked.push(pt); return pt; } };
});

const { toB64u } = await import("@ideatrail/crypto/bytes");
const { newId } = await import("@ideatrail/crypto/ids");
const { newKemKeyPair, randomKey } = await import("@ideatrail/crypto/keypair");
const { relock } = await import("@ideatrail/crypto/relock");
const { subkey } = await import("@ideatrail/crypto/subkey");
const { memoryStore, openEngineList, sealEngineList } = await import("./engine-list");
const { makeEnvelope } = await import("./signup/account");
const { openVault, unlockReason } = await import("./unlock");
type Api = import("./api").Api;

const zero = (b: Uint8Array) => b.every((x) => x === 0);

describe("temporary keys are zeroed", () => {
  it("the engine-list subkey, on seal, open and a failed open", () => {
    const mk = randomKey();
    const userId = newId();
    made.subkeys.length = 0;
    const blob = sealEngineList(mk, userId, { v: 1, version: 1, engines: [] });
    openEngineList(mk, userId, 1, blob);
    expect(() => openEngineList(mk, userId, 2, blob)).toThrow();
    expect(made.subkeys).toHaveLength(3);
    expect(made.subkeys.every(zero)).toBe(true);
  });

  it("the account private key when checking it against the server's public key throws", async () => {
    const userId = newId();
    const mk = randomKey();
    const ak = newKemKeyPair();
    const rawId = new Uint8Array(16).fill(1);
    const prf = new Uint8Array(32).fill(7);
    const wrapped = relock(subkey(mk, "account_priv"), "account_priv", { userId }, ak.priv);
    const api = {
      loginVerify: async () => ({ user_id: userId, envelope: makeEnvelope(mk, userId, prf, rawId) }),
      account: async () => ({ user_id: userId, engine_list: null, engine_list_version: 0, confirmed_at: "x", recovery_key_status: "set",
        account_pubkey: "not base64 !!", wrapped_account_privkey: toB64u(wrapped) }),
    } as unknown as Api;
    made.unlocked.length = 0;
    const prepared = { challenge_id: newId(), options: { challenge: "AAAA" }, preparedAt: 0 };
    const reason = await openVault(api, prepared, { assertion: {} as never, rawId, prf: new Uint8Array(prf) }, memoryStore()).then(() => "opened", unlockReason);
    expect(reason).toBe("account_mismatch");
    const akPriv = made.unlocked.find((b) => b.length === ak.priv.length);
    expect(akPriv && zero(akPriv)).toBe(true);
  });
});
