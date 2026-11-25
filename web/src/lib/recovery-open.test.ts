import { describe, expect, it, vi } from "vitest";
import e from "../../../spec/vectors/envelope.json";
import { fromB64u, fromHex, toB64u } from "@ideatrail/crypto/bytes";
import { newId } from "@ideatrail/crypto/ids";
import { prfWrapKey, unwrapMasterKey } from "@ideatrail/crypto/envelope";
import { COPY } from "./copy";
import { lockCreateError } from "./recovery-open";
import { ApiFailure, type Api, type RegisterOptions, type RegisterVerifyBody } from "./api";
import { fakeCredential } from "./testing/fake-credential";

const captured: Uint8Array[] = [];
vi.mock("@ideatrail/crypto/recovery", async (orig) => {
  const real = await orig<typeof import("@ideatrail/crypto/recovery")>();
  return { ...real, parseRecoveryKey: (s: string) => { const rk = real.parseRecoveryKey(s); captured.push(rk); return rk; } };
});
const { RecoveryFailure, finishRecovery, startRecovery, recoveryReason } = await import("./recovery-open");

const r = e.recovery;
const CHALLENGE_ID = newId();
const options: RegisterOptions = { challenge_id: newId(), user_id: e.user_id, options: { challenge: "AAAA", rp: { name: "x" }, user: { id: "AAAA", name: "n", displayName: "n" }, pubKeyCredParams: [] } };

/** A server that knows exactly the vector's recovery key. */
function fakeApi(): { api: Api; registerCalls: unknown[]; lookups: string[] } {
  const registerCalls: unknown[] = [];
  const lookups: string[] = [];
  const api = {
    recoveryEnvelope: async (b: { lookup_id: string }) => {
      lookups.push(b.lookup_id);
      if (b.lookup_id !== r.lookup_id) throw new ApiFailure(404, "recovery_not_found");
      return { user_id: e.user_id, envelope: { envelope_id: e.envelope_id, wrapped_master_key: toB64u(fromHex(r.envelope_hex)) }, recovery_challenge_id: CHALLENGE_ID, challenge: r.proof_challenge };
    },
    registerOptions: async (b: unknown) => {
      registerCalls.push(b);
      return options;
    },
  } as unknown as Api;
  return { api, registerCalls, lookups };
}

describe("startRecovery (spec §11)", () => {
  it("opens the master key with the right key, in any spacing and case, and sends the vector's proof signature", async () => {
    for (const typed of [r.rk_display, r.rk_display.toUpperCase(), r.rk_display.replace(/-/g, " "), r.rk_display.replace(/-/g, "")]) {
      const f = fakeApi();
      const s = await startRecovery(f.api, typed);
      expect(s.userId).toBe(e.user_id);
      expect(s.mk).toEqual(fromHex(e.mk_hex));
      expect(f.registerCalls).toEqual([{ recovery_challenge_id: CHALLENGE_ID, proof: toB64u(fromHex(r.proof_sig_hex)) }]);
    }
  });
  it("sends only the lookup id, never the key in any form", async () => {
    const f = fakeApi();
    await startRecovery(f.api, r.rk_display);
    const sent = JSON.stringify([f.lookups, f.registerCalls]);
    for (const form of [r.rk_display, r.rk_display.replace(/-/g, ""), r.rk_hex, toB64u(fromHex(r.rk_hex))]) expect(sent).not.toContain(form);
  });
  it("one wrong character never opens: no master key, no registration request", async () => {
    const first = r.rk_display[0] === "a" ? "b" : "a";
    const f = fakeApi();
    const err = await startRecovery(f.api, first + r.rk_display.slice(1)).catch((x) => x);
    expect(err).toBeInstanceOf(RecoveryFailure);
    expect(err.reason).toBe("not_found"); // a different key has a different lookup id
    expect(f.registerCalls).toEqual([]);
  });
  it("a key with the right lookup but a wrong wrapped key still opens nothing", async () => {
    const f = fakeApi();
    const api = { ...f.api, recoveryEnvelope: async () => ({ user_id: e.user_id, envelope: { envelope_id: e.envelope_id, wrapped_master_key: toB64u(fromHex(e.envelope_hex)) }, recovery_challenge_id: CHALLENGE_ID, challenge: "x" }) } as unknown as Api;
    const err = await startRecovery(api, r.rk_display).catch((x) => x);
    expect(err.reason).toBe("wrong_key");
    expect(f.registerCalls).toEqual([]);
  });
  it("rejects a malformed key before any request", async () => {
    const f = fakeApi();
    for (const bad of ["", "abc", r.rk_display.slice(0, -1), r.rk_display + "a", "u".repeat(52)]) expect((await startRecovery(f.api, bad).catch((x) => x)).reason).toBe("format");
    expect(f.lookups).toEqual([]);
  });
  it("zeroes the typed key's bytes on success and on every failure", async () => {
    captured.length = 0;
    const f = fakeApi();
    await startRecovery(f.api, r.rk_display);
    await startRecovery(f.api, "b" + r.rk_display.slice(1)).catch(() => undefined);
    expect(captured).toHaveLength(2);
    for (const rk of captured) expect(rk.every((b) => b === 0)).toBe(true);
  });
  it("wipes the opened master key when the registration options fail, and maps the server's codes", async () => {
    const f = fakeApi();
    for (const [code, reason] of [["challenge_invalid", "expired"], ["offline", "offline"], ["recovery_proof_failed", "wrong_key"], ["unknown", "failed"]] as const) {
      const api = { ...f.api, registerOptions: async () => { throw new ApiFailure(code === "offline" ? 0 : 400, code); } } as unknown as Api;
      expect((await startRecovery(api, r.rk_display).catch((x) => x)).reason).toBe(reason);
    }
    expect(recoveryReason(new ApiFailure(0, "offline"))).toBe("offline");
  });
  it("refuses options that name another account", async () => {
    const f = fakeApi();
    const api = { ...f.api, registerOptions: async () => ({ ...options, user_id: newId() }) } as unknown as Api;
    expect((await startRecovery(api, r.rk_display).catch((x) => x)).reason).toBe("failed");
  });
});

describe("finishRecovery", () => {
  it("registers the new device lock with an envelope only that lock can open, then wipes the master key", async () => {
    const f = fakeApi();
    const state = await startRecovery(f.api, r.rk_display);
    const sent: RegisterVerifyBody[] = [];
    const api = { registerVerify: async (b: RegisterVerifyBody) => { sent.push(b); return { user_id: e.user_id }; } } as unknown as Api;
    const prf = new Uint8Array(32).fill(7);
    const created = { credential: fakeCredential({ kind: "create", prf }), rawId: new Uint8Array(16).fill(1), prf };
    await finishRecovery(api, state, created, prf.slice());
    expect(sent).toHaveLength(1);
    expect(sent[0].challenge_id).toBe(options.challenge_id);
    const back = unwrapMasterKey(prfWrapKey(prf, created.rawId), e.user_id, sent[0].envelope.envelope_id, fromB64u(sent[0].envelope.wrapped_master_key));
    expect(back).toEqual(fromHex(e.mk_hex));
    expect(state.mk.every((b) => b === 0)).toBe(true);
  });
  it("wipes the master key even when the server refuses", async () => {
    const f = fakeApi();
    const state = await startRecovery(f.api, r.rk_display);
    const api = { registerVerify: async () => { throw new ApiFailure(400, "challenge_invalid"); } } as unknown as Api;
    const prf = new Uint8Array(32).fill(7);
    await expect(finishRecovery(api, state, { credential: fakeCredential({ kind: "create", prf }), rawId: new Uint8Array(16).fill(1), prf }, prf.slice())).rejects.toBeInstanceOf(ApiFailure);
    expect(state.mk.every((b) => b === 0)).toBe(true);
  });
});

describe("lockCreateError (G2 2026-11-25: Windows Chrome chose the phone that already holds a lock)", () => {
  it("says the chosen device already has a lock for InvalidStateError", () => {
    expect(lockCreateError(new DOMException("x", "InvalidStateError"))).toBe(COPY.errors.already_here);
  });
  it("keeps the cancel wording for a cancelled prompt", () => {
    expect(lockCreateError(new DOMException("x", "NotAllowedError"))).toBe(COPY.errors.passkey_cancel);
  });
  it("adds the error name, never the message, to anything else", () => {
    expect(lockCreateError(new DOMException("secret detail", "UnknownError"))).toBe(`${COPY.errors.generic} (${COPY.dash.errorCode} UnknownError)`);
    expect(lockCreateError("weird")).toBe(`${COPY.errors.generic} (${COPY.dash.errorCode} unknown)`);
  });
});
