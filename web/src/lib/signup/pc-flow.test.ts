import { describe, expect, it } from "vitest";
import { fromB64u, toB64u, toHex } from "@ideatrail/crypto/bytes";
import { newKemKeyPair, randomKey } from "@ideatrail/crypto/keypair";
import type { Api, DeliverBody, RegisterVerifyBody } from "../api";
import { memoryStore, rememberVersion } from "../engine-list";
import { fakeCredential } from "../testing/fake-credential";
import { finishAccount, handOff } from "./pc-flow";

const SID = "01jcm3v8q7s2kx4f9d6b5n0tqw";
const USER = "01jcm3v8q7s2kx4f9d6b5n0tqx";

function fakeApi(calls: string[], seen: { verify?: RegisterVerifyBody; deliver?: DeliverBody }, version = 0): Api {
  return {
    registerVerify: async (b: RegisterVerifyBody) => { calls.push("verify"); seen.verify = b; return { user_id: USER }; },
    confirm: async () => { calls.push("confirm"); return { confirmed: true }; },
    account: async () => { calls.push("account"); return { user_id: USER, engine_list: null, engine_list_version: version, confirmed_at: "x", recovery_key_status: "none" }; },
    deliver: async (_s: string, b: DeliverBody) => { calls.push("deliver"); seen.deliver = b; return { engine_id: SID, engine_list_version: b.engine_list_version }; },
  } as unknown as Api;
}

describe("step 1 orchestration", () => {
  it("registers, then confirms, then delivers — and never sends the PRF output", async () => {
    const calls: string[] = [];
    const seen: { verify?: RegisterVerifyBody; deliver?: DeliverBody } = {};
    const api = fakeApi(calls, seen);
    const prf = new Uint8Array(32).fill(7);
    const created = { credential: fakeCredential({ prf }), rawId: Uint8Array.of(1), prf };
    const vault = await finishAccount(api, { challengeId: "c", userId: USER, created, prf });
    const ek = newKemKeyPair();
    const info = { engine_id: SID, sign_pubkey: toB64u(randomKey()), kem_pubkey: toB64u(ek.pub), expires_at: "x", delivered: false };
    const link = { sessionId: SID, signFp: randomKey(), kemFp: randomKey(), psk: randomKey(), computerName: "Steven-Air" };
    const store = memoryStore();
    const entry = await handOff(api, { link, info, kemPub: ek.pub }, vault, store);
    expect(calls).toEqual(["verify", "confirm", "account", "deliver"]);
    expect(seen.verify?.response.clientExtensionResults).toEqual({});
    expect(JSON.stringify(seen.verify)).not.toContain(toB64u(prf));
    expect(seen.verify?.account?.account_pubkey).toBe(toB64u(vault.akPub));
    expect(entry.name).toBe("Steven-Air");
    expect(store.get(`it.elv.${USER}`)).toBe("1");
    expect(fromB64u(seen.deliver!.payload)[3]).toBe(8);
    // Neither the PRF output nor MK nor the account private key appears in any body sent to the server.
    const sent = JSON.stringify([seen.verify, seen.deliver]);
    for (const secret of [prf, vault.mk, vault.akPriv]) {
      expect(sent).not.toContain(toB64u(secret));
      expect(sent).not.toContain(toHex(secret));
    }
  });
  it("refuses to deliver when the server shows an older engine list than this browser saw", async () => {
    const api = fakeApi([], {}, 0);
    const store = memoryStore();
    rememberVersion(store, USER, 3);
    const vault = { userId: USER, mk: randomKey(), akPriv: randomKey(), akPub: randomKey() };
    const link = { sessionId: SID, signFp: randomKey(), kemFp: randomKey(), psk: randomKey(), computerName: "x" };
    const info = { engine_id: SID, sign_pubkey: "s", kem_pubkey: "k", expires_at: "x", delivered: false };
    await expect(handOff(api, { link, info, kemPub: randomKey() }, vault, store)).rejects.toThrow("engine_list_rollback");
  });
});
