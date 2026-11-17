import { describe, expect, it } from "vitest";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { createAuthenticator } from "./authenticator";

const rp = { rpId: "localhost", origin: "http://localhost:4321" };

async function registered() {
  const a = await createAuthenticator(rp);
  const opts = await generateRegistrationOptions({ rpName: "t", rpID: rp.rpId, userName: "u", attestationType: "none" });
  const v = await verifyRegistrationResponse({ response: await a.register(opts), expectedChallenge: opts.challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpId });
  return { a, v };
}

describe("virtual authenticator", () => {
  it("registration verifies", async () => {
    const { v } = await registered();
    expect(v.verified).toBe(true);
  });

  it("login verifies with the stored credential, and replayed counters are rejected", async () => {
    const { a, v } = await registered();
    const cred = v.registrationInfo!.credential;
    const opts = await generateAuthenticationOptions({ rpID: rp.rpId });
    a.setSignCount(5);
    const ok = await verifyAuthenticationResponse({ response: await a.login(opts, { signCount: 5 }), expectedChallenge: opts.challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpId, credential: { ...cred, counter: 4 } });
    expect(ok.verified).toBe(true);
    await expect(verifyAuthenticationResponse({ response: await a.login(opts, { signCount: 3 }), expectedChallenge: opts.challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpId, credential: { ...cred, counter: 4 } })).rejects.toThrow();
  });

  it("wrong origin or challenge is rejected", async () => {
    const a = await createAuthenticator(rp);
    const opts = await generateRegistrationOptions({ rpName: "t", rpID: rp.rpId, userName: "u" });
    await expect(verifyRegistrationResponse({ response: await a.register(opts, { origin: "https://evil.example" }), expectedChallenge: opts.challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpId })).rejects.toThrow();
    await expect(verifyRegistrationResponse({ response: await a.register(opts), expectedChallenge: "other", expectedOrigin: rp.origin, expectedRPID: rp.rpId })).rejects.toThrow();
  });
});
