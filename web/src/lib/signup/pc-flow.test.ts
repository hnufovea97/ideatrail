import { afterEach, describe, expect, it, vi } from "vitest";
import { fromB64u, toB64u, toHex } from "@ideatrail/crypto/bytes";
import { prfWrapKey, unwrapMasterKey } from "@ideatrail/crypto/envelope";
import { newKemKeyPair, randomKey } from "@ideatrail/crypto/keypair";
import { ApiFailure, type Api, type CreationOptionsJSON, type DeliverBody, type RegisterVerifyBody } from "../api";
import { memoryStore, rememberVersion } from "../engine-list";
import { fakeCredential } from "../testing/fake-credential";
import { createPasskey, readPrf } from "../webauthn";
import { finishAccount, handOff, handOffAgain, prepareAccount, submitAccount, verifyFailure } from "./pc-flow";

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
  it("a retried register/verify sends the very same account and envelope (one MK, one credential)", async () => {
    const bodies: RegisterVerifyBody[] = [];
    let fail = true;
    const api = { registerVerify: async (b: RegisterVerifyBody) => { bodies.push(b); if (fail) { fail = false; throw new ApiFailure(0, "offline"); } return { user_id: USER }; } } as unknown as Api;
    const prf = new Uint8Array(32).fill(3);
    const prepared = prepareAccount({ challengeId: "c", userId: USER, created: { credential: fakeCredential({ prf }), rawId: Uint8Array.of(1), prf }, prf });
    await expect(submitAccount(api, prepared)).rejects.toThrow("offline");
    expect(await submitAccount(api, prepared)).toBe(prepared.vault);
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[1])).toBe(JSON.stringify(bodies[0]));
  });
});

describe("handoff retry (the first deliver's answer may have been lost)", () => {
  const ek = newKemKeyPair();
  const info = { engine_id: SID, sign_pubkey: "s", kem_pubkey: toB64u(ek.pub), expires_at: "x", delivered: false };
  const link = { sessionId: SID, signFp: randomKey(), kemFp: randomKey(), psk: randomKey(), computerName: "Steven-Air" };
  const vault = { userId: USER, mk: randomKey(), akPriv: randomKey(), akPub: randomKey() };

  it("already delivered → success, nothing sent again", async () => {
    const calls: string[] = [];
    const api = { ...fakeApi(calls, {}), pairing: async () => { calls.push("pairing"); return { ...info, delivered: true }; } } as unknown as Api;
    const entry = await handOffAgain(api, { link, info, kemPub: ek.pub }, vault, memoryStore());
    expect(calls).toEqual(["pairing"]);
    expect(entry.engine_id).toBe(SID);
    expect(entry.name).toBe("Steven-Air");
  });
  it("not delivered yet → the normal handoff", async () => {
    const calls: string[] = [];
    const api = { ...fakeApi(calls, {}), pairing: async () => { calls.push("pairing"); return info; } } as unknown as Api;
    await handOffAgain(api, { link, info, kemPub: ek.pub }, vault, memoryStore());
    expect(calls).toEqual(["pairing", "confirm", "account", "deliver"]);
  });
});

describe("register/verify failure: forget the passkey only on a definitive refusal", () => {
  it("a 4xx answer is a refusal", () => {
    for (const s of [400, 403, 409, 410]) expect(verifyFailure(new ApiFailure(s, "x"))).toBe("refused");
  });
  it("offline, timeout, 5xx or anything else is unsure: the server may have stored it", () => {
    expect(verifyFailure(new ApiFailure(0, "offline"))).toBe("unsure");
    expect(verifyFailure(new ApiFailure(502, "unknown"))).toBe("unsure");
    expect(verifyFailure(new ApiFailure(200, "bad_response"))).toBe("unsure");
    expect(verifyFailure(new Error("boom"))).toBe("unsure");
    expect(verifyFailure(new DOMException("x", "AbortError"))).toBe("unsure");
  });
});

const OPTIONS: CreationOptionsJSON = {
  challenge: "Y2hhbGxlbmdl", rp: { id: "localhost", name: "Ideatrail" }, user: { id: "dXNlcg", name: "Ideatrail", displayName: "Ideatrail" },
  pubKeyCredParams: [{ type: "public-key", alg: -7 }], authenticatorSelection: { residentKey: "required", userVerification: "required" }, attestation: "none",
};

describe("step 1 PRF get fallback (spec §11 P3)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("create gives no PRF, get on the same credential does: the account is made from get's PRF and handed off", async () => {
    const prf = new Uint8Array(32).fill(11);
    const seen: { get?: CredentialRequestOptions } = {};
    vi.stubGlobal("navigator", {
      credentials: {
        create: () => Promise.resolve(fakeCredential({ prf: null, rawId: 4 })),
        get: (o: CredentialRequestOptions) => { seen.get = o; return Promise.resolve(fakeCredential({ prf, kind: "get", rawId: 4 })); },
      },
    });
    const calls: string[] = [];
    const sent: { verify?: RegisterVerifyBody; deliver?: DeliverBody } = {};
    const api = fakeApi(calls, sent);

    const created = await createPasskey(OPTIONS);
    expect(created.prf).toBeNull();
    const got = await readPrf(created.rawId, "localhost");
    expect(got).toEqual(prf);
    expect(new Uint8Array(seen.get!.publicKey!.allowCredentials![0].id as ArrayBuffer)).toEqual(created.rawId);

    const vault = await finishAccount(api, { challengeId: "c", userId: USER, created, prf: got! });
    const env = sent.verify!.envelope;
    expect(unwrapMasterKey(prfWrapKey(prf, created.rawId), USER, env.envelope_id, fromB64u(env.wrapped_master_key))).toEqual(vault.mk);
    expect(JSON.stringify(sent.verify)).not.toContain(toB64u(prf));

    const ek = newKemKeyPair();
    const info = { engine_id: SID, sign_pubkey: toB64u(randomKey()), kem_pubkey: toB64u(ek.pub), expires_at: "x", delivered: false };
    const link = { sessionId: SID, signFp: randomKey(), kemFp: randomKey(), psk: randomKey(), computerName: "Steven-Air" };
    await handOff(api, { link, info, kemPub: ek.pub }, vault, memoryStore());
    expect(calls).toEqual(["verify", "confirm", "account", "deliver"]);
  });
});
