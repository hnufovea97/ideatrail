import { describe, expect, it } from "vitest";
import { randomKey } from "@ideatrail/crypto/keypair";
import type { AccountInfo } from "../api";
import { checkRows, dueCheck, MAX_NOTE_CHARS, openNotes, openReminder, sealNotes, sealReminder, shortcutNeeded } from "./reminder";

const U = "01jcm3v8q7s2kx4f9d6b5n0tqw";
const OTHER = "01jcm3v8q7s2kx4f9d6b5n0tqx";
const DAY = 86_400_000;
const signup = new Date(2026, 10, 20, 15, 30); // local time: Nov 20, 15:30
const at = (y: number, m: number, d: number, h = 9) => new Date(y, m, d, h);

describe("dueCheck (D7)", () => {
  it("is false on the signup day, even late at night", () => {
    expect(dueCheck(null, signup.toISOString(), at(2026, 10, 20, 23))).toBe(false);
  });
  it("is true at the first open from the next local midnight", () => {
    expect(dueCheck(null, signup.toISOString(), at(2026, 10, 21, 0))).toBe(true);
    expect(dueCheck(null, signup.toISOString(), at(2026, 10, 21, 9))).toBe(true);
  });
  it("is false again the same day once shown_at is saved", () => {
    const now = at(2026, 10, 21, 9);
    expect(dueCheck({ v: 1, shown_at: now.toISOString() }, signup.toISOString(), at(2026, 10, 21, 18))).toBe(false);
  });
  it("waits 90 days: 89 no, 90 yes", () => {
    const shown = at(2026, 10, 21, 9);
    const state = { v: 1 as const, shown_at: shown.toISOString() };
    expect(dueCheck(state, signup.toISOString(), new Date(shown.getTime() + 89 * DAY))).toBe(false);
    expect(dueCheck(state, signup.toISOString(), new Date(shown.getTime() + 90 * DAY))).toBe(true);
  });
  it("is false for a created_at it cannot read, and true for a shown_at it cannot read", () => {
    expect(dueCheck(null, "garbage", at(2027, 0, 1))).toBe(false);
    expect(dueCheck({ v: 1, shown_at: "garbage" }, signup.toISOString(), at(2026, 10, 22))).toBe(true);
  });
});

describe("sealed state and notes (spec §3 relock 0x85 / 0x84)", () => {
  it("round-trips the reminder state and fails for another user", () => {
    const mk = randomKey();
    const blob = sealReminder(mk, U, { v: 1, shown_at: "2026-11-21T00:00:00.000Z" });
    expect(openReminder(mk, U, blob)).toEqual({ v: 1, shown_at: "2026-11-21T00:00:00.000Z" });
    expect(openReminder(mk, OTHER, blob)).toBeNull();
    expect(openReminder(randomKey(), U, blob)).toBeNull();
  });
  it("treats a missing or damaged state as no state", () => {
    const mk = randomKey();
    expect(openReminder(mk, U, null)).toBeNull();
    expect(openReminder(mk, U, "!!not base64!!")).toBeNull();
    expect(openReminder(mk, U, "AAAA")).toBeNull();
  });
  it("round-trips a note, rejects other users, and keeps notes and state apart", () => {
    const mk = randomKey();
    const blob = sealNotes(mk, U, "비상 열쇠는 서랍 두 번째 칸");
    expect(openNotes(mk, U, blob)).toBe("비상 열쇠는 서랍 두 번째 칸");
    expect(openNotes(mk, OTHER, blob)).toBeNull();
    expect(openReminder(mk, U, blob)).toBeNull();
    expect(openNotes(mk, U, sealReminder(mk, U, { v: 1, shown_at: "x" }))).toBeNull();
  });
  it("an empty server value is an empty note; a damaged one is unreadable (null), never a throw", () => {
    const mk = randomKey();
    expect(openNotes(mk, U, null)).toBe("");
    expect(openNotes(mk, U, "AAAA")).toBeNull();
  });
  it("accepts exactly 500 characters and rejects 501", () => {
    const mk = randomKey();
    expect(openNotes(mk, U, sealNotes(mk, U, "가".repeat(MAX_NOTE_CHARS)))).toBe("가".repeat(MAX_NOTE_CHARS));
    expect(() => sealNotes(mk, U, "가".repeat(MAX_NOTE_CHARS + 1))).toThrow("note_too_long");
  });
  it("never encrypts with a wiped key", () => {
    expect(() => sealNotes(new Uint8Array(32), U, "x")).toThrow();
  });
});

const acct = (o: Partial<AccountInfo>): AccountInfo => ({ user_id: U, engine_list: null, engine_list_version: 0, confirmed_at: null, recovery_key_status: "none", ...o });

describe("check rows", () => {
  it("recovery key: none, then made with its date", () => {
    expect(checkRows(acct({}), false).recovery).toEqual({ madeAt: null });
    const made = acct({ recovery_key_status: "created", envelopes: [
      { envelope_id: "a", method: "recovery", created_at: "2026-11-10T00:00:00Z", last_used_at: null },
      { envelope_id: "b", method: "recovery", created_at: "2026-11-14T00:00:00Z", last_used_at: null },
      { envelope_id: "c", method: "passkey", created_at: "2026-11-20T00:00:00Z", last_used_at: null }] });
    expect(checkRows(made, false).recovery).toEqual({ madeAt: "2026-11-14T00:00:00Z" });
  });
  it("devices: count and storage place names", () => {
    const r = checkRows(acct({ credentials: [
      { credential_id: "x", aaguid: "08987058-cadc-4b81-b6e1-30de50dcbe96", created_at: "2026-11-01T00:00:00Z", last_used_at: null },
      { credential_id: "y", aaguid: null, created_at: "2026-11-02T00:00:00Z", last_used_at: null }] }), false);
    expect(r.devices).toEqual({ count: 2, places: ["Windows Hello", "기기 잠금"] });
    expect(checkRows(acct({}), false).devices).toEqual({ count: 0, places: [] });
  });
  it("GitHub on and off", () => {
    expect(checkRows(acct({}), true).github).toBe(true);
    expect(checkRows(acct({}), false).github).toBe(false);
  });
  it("the home-screen shortcut shows only on a touch phone that is not already installed", () => {
    expect(shortcutNeeded({ touch: true, narrow: true, standalone: false })).toBe(true);
    expect(shortcutNeeded({ touch: true, narrow: true, standalone: true })).toBe(false);
    expect(shortcutNeeded({ touch: false, narrow: false, standalone: false })).toBe(false);
    expect(shortcutNeeded({ touch: true, narrow: false, standalone: false })).toBe(false);
  });
});
