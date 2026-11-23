import { describe, expect, it } from "vitest";
import { PRF_SALT } from "@ideatrail/crypto/envelope";
import type { RequestOptionsJSON } from "./api";
import { fakeCredential } from "./testing/fake-credential";
import { assertWithPrf } from "./webauthn";

const options: RequestOptionsJSON = { challenge: "AAAA", rpId: "localhost", timeout: 60_000, userVerification: "required" };

function fakeNav(cred: PublicKeyCredential) {
  const calls: CredentialRequestOptions[] = [];
  const nav = { get: async (o: CredentialRequestOptions) => { calls.push(o); return cred; } } as unknown as CredentialsContainer;
  return { calls, nav };
}

describe("login = unlock: one get with the PRF salt", () => {
  it("asks for the PRF output with the fixed salt and hands it back, never inside the JSON for the server", async () => {
    const prf = new Uint8Array(32).fill(9);
    const { calls, nav } = fakeNav(fakeCredential({ kind: "get", prf }));
    const got = await assertWithPrf(options, nav);
    const pk = calls[0].publicKey!;
    expect(new Uint8Array((pk.extensions as { prf: { eval: { first: ArrayBuffer } } }).prf.eval.first)).toEqual(PRF_SALT);
    expect(pk.userVerification).toBe("required");
    expect(pk.allowCredentials).toEqual([]); // discoverable: the device picks its own passkey
    expect(got.prf).toEqual(prf);
    expect(got.rawId).toEqual(new Uint8Array(16).fill(1));
    expect(got.assertion.clientExtensionResults).toEqual({});
  });
  it("gives null when the authenticator returns no PRF output", async () => {
    const { nav } = fakeNav(fakeCredential({ kind: "get", prf: null }));
    expect((await assertWithPrf(options, nav)).prf).toBeNull();
  });
  it("calls get before any await (Safari user-activation rule, QA B4)", () => {
    const { calls, nav } = fakeNav(fakeCredential({ kind: "get", prf: null }));
    void assertWithPrf(options, nav);
    expect(calls).toHaveLength(1);
  });
});
