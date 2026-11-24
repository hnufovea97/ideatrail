import { describe, expect, it, vi } from "vitest";
import { fromB64u } from "@ideatrail/crypto/bytes";
import { newId } from "@ideatrail/crypto/ids";
import { memoryStore } from "./engine-list";
import { disconnectEngine, DisconnectRefused, sendDecision } from "./manage-actions";
import { VaultLocked } from "./live-key";
import type { StepupAssertion } from "./api";
import { fakeWorld, recordRow, syncOf, type World } from "./testing/fake-world";

const ASSERTION = { challenge_id: "c", response: {} } as unknown as StepupAssertion;

/** A device-lock answer that arrives when the test says so. */
function pendingLock() {
  let done!: (a: StepupAssertion) => void;
  const asked = new Promise<StepupAssertion>((resolve) => { done = resolve; });
  return { asked, answer: () => done(ASSERTION) };
}

const wipe = (w: World) => { w.vault.mk.fill(0); w.vault.akPriv.fill(0); };

describe("sendDecision: a lock during the device-lock prompt", () => {
  const kem = (w: World) => fromB64u(w.list.engines[0].kem_pubkey);

  it("sends the sealed answer when the vault is still open", async () => {
    const w = fakeWorld();
    const api = { decide: vi.fn().mockResolvedValue({ approval_id: "a", status: "approved" }) };
    await sendDecision({ api, vault: w.vault, signal: new AbortController().signal, kem: kem(w), approvalId: newId(), decision: "approved", asked: Promise.resolve(ASSERTION) });
    expect(api.decide).toHaveBeenCalledOnce();
  });

  it("sends nothing when the signal aborts while the prompt is pending", async () => {
    const w = fakeWorld();
    const api = { decide: vi.fn() };
    const ctl = new AbortController();
    const lock = pendingLock();
    const job = sendDecision({ api, vault: w.vault, signal: ctl.signal, kem: kem(w), approvalId: newId(), decision: "approved", asked: lock.asked });
    ctl.abort();
    wipe(w);
    lock.answer();
    await expect(job).rejects.toBeInstanceOf(VaultLocked);
    expect(api.decide).not.toHaveBeenCalled();
  });

  it("sends nothing from a wiped vault even when the signal was not aborted", async () => {
    const w = fakeWorld();
    const api = { decide: vi.fn() };
    const lock = pendingLock();
    const job = sendDecision({ api, vault: w.vault, signal: new AbortController().signal, kem: kem(w), approvalId: newId(), decision: "rejected", asked: lock.asked });
    wipe(w);
    lock.answer();
    await expect(job).rejects.toThrow("zero_key");
    expect(api.decide).not.toHaveBeenCalled();
  });
});

describe("disconnectEngine: a lock during the device-lock prompt", () => {
  async function ready() {
    const w = fakeWorld();
    const root = newId();
    const sync = syncOf({ records: [await recordRow(w, { rootId: root, seq: 1 })] });
    return { w, sync };
  }

  it("saves the cutoff and remembers the version when the vault is open", async () => {
    const { w, sync } = await ready();
    const api = { revokeEngine: vi.fn().mockResolvedValue({}) };
    const marks = memoryStore();
    const next = await disconnectEngine({ api, vault: w.vault, sync, marks, signal: new AbortController().signal, engineId: w.engine.id, asked: Promise.resolve(ASSERTION) });
    expect(api.revokeEngine).toHaveBeenCalledOnce();
    expect(next.engines[0].revoked_after_seq).toBe("1");
    expect(marks.get(`it.elv.${w.userId}`)).toBe(String(next.version));
  });

  it("revokes nothing when the signal aborts while the prompt is pending", async () => {
    const { w, sync } = await ready();
    const api = { revokeEngine: vi.fn() };
    const ctl = new AbortController();
    const lock = pendingLock();
    const job = disconnectEngine({ api, vault: w.vault, sync, marks: memoryStore(), signal: ctl.signal, engineId: w.engine.id, asked: lock.asked });
    ctl.abort();
    wipe(w);
    lock.answer();
    await expect(job).rejects.toBeInstanceOf(VaultLocked);
    expect(api.revokeEngine).not.toHaveBeenCalled();
  });

  it("revokes nothing from a wiped vault even when the signal was not aborted", async () => {
    const { w, sync } = await ready();
    const api = { revokeEngine: vi.fn() };
    const lock = pendingLock();
    const job = disconnectEngine({ api, vault: w.vault, sync, marks: memoryStore(), signal: new AbortController().signal, engineId: w.engine.id, asked: lock.asked });
    wipe(w);
    lock.answer();
    await expect(job).rejects.toThrow("zero_key");
    expect(api.revokeEngine).not.toHaveBeenCalled();
  });

  it("refuses, sending nothing, when the engine's rows are not all accounted for", async () => {
    const w = fakeWorld();
    const sync = syncOf({ records: [await recordRow(w, { rootId: newId(), seq: 2 })] }); // seq 1 is missing
    const api = { revokeEngine: vi.fn() };
    await expect(disconnectEngine({ api, vault: w.vault, sync, marks: memoryStore(), signal: new AbortController().signal, engineId: w.engine.id, asked: Promise.resolve(ASSERTION) }))
      .rejects.toBeInstanceOf(DisconnectRefused);
    expect(api.revokeEngine).not.toHaveBeenCalled();
  });
});
