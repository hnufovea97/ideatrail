import { describe, expect, it } from "vitest";
import { PRF_SALT } from "@ideatrail/crypto/envelope";
import { toB64u } from "@ideatrail/crypto/bytes";
import type { CreationOptionsJSON } from "./api";
import { assertWithPasskey, createPasskey, creationOptions, readPrf, registrationJSON } from "./webauthn";
import { fakeCredential } from "./testing/fake-credential";

const OPTIONS: CreationOptionsJSON = {
  challenge: "Y2hhbGxlbmdl", rp: { id: "localhost", name: "Ideatrail" }, user: { id: "dXNlcg", name: "Ideatrail", displayName: "Ideatrail" },
  pubKeyCredParams: [{ type: "public-key", alg: -8 }, { type: "public-key", alg: -7 }], excludeCredentials: [{ id: "AQID", type: "public-key" }],
  authenticatorSelection: { residentKey: "required", userVerification: "required" }, attestation: "none",
};
const nav = (c: PublicKeyCredential | null, seen: { create?: CredentialCreationOptions; get?: CredentialRequestOptions } = {}) =>
  ({ create: (o: CredentialCreationOptions) => { seen.create = o; return Promise.resolve(c); }, get: (o: CredentialRequestOptions) => { seen.get = o; return Promise.resolve(c); } }) as unknown as CredentialsContainer;

describe("passkeys with PRF", () => {
  it("adds the fixed PRF salt and decodes ids", () => {
    const o = creationOptions(OPTIONS);
    const prf = (o.extensions as { prf: { eval: { first: ArrayBuffer } } }).prf.eval.first;
    expect(new Uint8Array(prf)).toEqual(PRF_SALT);
    expect(new Uint8Array(o.challenge as ArrayBuffer)).toEqual(new TextEncoder().encode("challenge"));
    expect(new Uint8Array((o.excludeCredentials ?? [])[0].id as ArrayBuffer)).toEqual(Uint8Array.of(1, 2, 3));
  });
  it("calls navigator.credentials.create before any await (Safari user activation, QA B4)", () => {
    let called = false;
    const n = { create: () => { called = true; return new Promise(() => {}); } } as unknown as CredentialsContainer;
    void createPasskey(OPTIONS, n);
    expect(called).toBe(true);
  });
  it("returns the PRF output when create gives one, null when it does not", async () => {
    const prf = new Uint8Array(32).fill(7);
    expect((await createPasskey(OPTIONS, nav(fakeCredential({ prf })))).prf).toEqual(prf);
    expect((await createPasskey(OPTIONS, nav(fakeCredential({ prf: null })))).prf).toBeNull();
  });
  it("readPrf asks only for that credential with user verification", async () => {
    const seen: { get?: CredentialRequestOptions } = {};
    const prf = new Uint8Array(32).fill(9);
    expect(await readPrf(Uint8Array.of(1, 1), "localhost", nav(fakeCredential({ prf, kind: "get" }), seen))).toEqual(prf);
    expect(seen.get?.publicKey?.allowCredentials?.length).toBe(1);
    expect(seen.get?.publicKey?.userVerification).toBe("required");
  });
  it("the registration JSON sent to the server never carries extension results (PRF output stays here)", () => {
    const prf = new Uint8Array(32).fill(7);
    const json = registrationJSON(fakeCredential({ prf }));
    expect(json.clientExtensionResults).toEqual({});
    expect(JSON.stringify(json)).not.toContain(toB64u(prf));
    expect(json.response.transports).toEqual(["internal"]);
    expect(json.response.publicKeyAlgorithm).toBe(-7);
  });
  it("assertWithPasskey calls get synchronously and omits a null userHandle", async () => {
    let called = false;
    const n = { get: () => { called = true; return Promise.resolve(fakeCredential({ kind: "get" })); } } as unknown as CredentialsContainer;
    const p = assertWithPasskey({ challenge: "Y2hhbGxlbmdl", rpId: "localhost", allowCredentials: [] }, n);
    expect(called).toBe(true);
    const a = await p;
    expect(a.response.userHandle).toBeUndefined();
    expect(a.clientExtensionResults).toEqual({});
  });
  it("bad options reject instead of throwing synchronously, so .catch() sees them", async () => {
    const bad = { ...OPTIONS, challenge: "!!not base64!!" };
    let p: Promise<unknown> | undefined;
    expect(() => { p = createPasskey(bad, nav(null)); }).not.toThrow();
    await expect(p).rejects.toThrow();
    let q: Promise<unknown> | undefined;
    expect(() => { q = assertWithPasskey({ challenge: "!!not base64!!" }, nav(null)); }).not.toThrow();
    await expect(q).rejects.toThrow();
    const throwing = { get: () => { throw new TypeError("no webauthn"); } } as unknown as CredentialsContainer;
    let r: Promise<unknown> | undefined;
    expect(() => { r = readPrf(Uint8Array.of(1), "localhost", throwing); }).not.toThrow();
    await expect(r).rejects.toThrow("no webauthn");
  });
  it("always asks for user verification on create, whatever the server sent", () => {
    expect(creationOptions({ ...OPTIONS, authenticatorSelection: { residentKey: "required", userVerification: "discouraged" } }).authenticatorSelection?.userVerification).toBe("required");
    expect(creationOptions({ ...OPTIONS, authenticatorSelection: undefined }).authenticatorSelection?.userVerification).toBe("required");
  });
});
