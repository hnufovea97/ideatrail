// 챙길 것 카드 (UX ⑥-3, D7·D8): when to show it, what it remembers, and what each row says.
// The shown-at time and the recall note are relocked under their own subkeys (spec §3, AAD {user_id}); the server holds only the
// sealed bytes. Every temporary subkey is zeroed after use. A damaged blob never throws to the screen.
import { fromB64u, toB64u, utf8 } from "@ideatrail/crypto/bytes";
import { relock, unlock, type Purpose } from "@ideatrail/crypto/relock";
import { subkey } from "@ideatrail/crypto/subkey";
import type { AccountInfo } from "../api";
import { storagePlace } from "../devices";
import { assertLive } from "../live-key";

export interface ReminderState { v: 1; shown_at: string }

export const MAX_NOTE_CHARS = 500;
const REMIND_AGAIN_DAYS = 90;
const DAY_MS = 86_400_000;

/** True from the local midnight after signup, when never shown or the last showing is 90 or more days old. */
export function dueCheck(state: ReminderState | null, createdAt: string, now: Date): boolean {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return false;
  const nextDay = new Date(created.getFullYear(), created.getMonth(), created.getDate() + 1);
  if (now.getTime() < nextDay.getTime()) return false;
  if (!state) return true;
  const shown = Date.parse(state.shown_at);
  return Number.isNaN(shown) || now.getTime() >= shown + REMIND_AGAIN_DAYS * DAY_MS;
}

function withKey<T>(mk: Uint8Array, purpose: Purpose, use: (k: Uint8Array) => T): T {
  assertLive(mk); // a vault wiped by the lock must not seal or open anything (the subkey of zeros is not zeros)
  const k = subkey(mk, purpose);
  try {
    return use(k);
  } finally {
    k.fill(0);
  }
}

const seal = (mk: Uint8Array, userId: string, purpose: Purpose, value: unknown): string =>
  withKey(mk, purpose, (k) => toB64u(relock(k, purpose, { userId }, utf8(JSON.stringify(value)))));

/** The decrypted JSON, or null for a missing, damaged, foreign or wrong-purpose blob. */
function open(mk: Uint8Array, userId: string, purpose: Purpose, blob: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(withKey(mk, purpose, (k) => unlock(k, purpose, { userId }, fromB64u(blob)))));
  } catch {
    return null;
  }
}

export const sealReminder = (mk: Uint8Array, userId: string, state: ReminderState): string => seal(mk, userId, "reminder_state", state);

export function openReminder(mk: Uint8Array, userId: string, blob: string | null | undefined): ReminderState | null {
  if (!blob) return null;
  const v = open(mk, userId, "reminder_state", blob) as Partial<ReminderState> | null;
  return v && v.v === 1 && typeof v.shown_at === "string" ? { v: 1, shown_at: v.shown_at } : null;
}

export function sealNotes(mk: Uint8Array, userId: string, text: string): string {
  if ([...text].length > MAX_NOTE_CHARS) throw new Error("note_too_long");
  return seal(mk, userId, "recall_notes", { v: 1, text });
}

/** "" when nothing was saved; null when something is saved but cannot be opened. */
export function openNotes(mk: Uint8Array, userId: string, blob: string | null | undefined): string | null {
  if (!blob) return "";
  const v = open(mk, userId, "recall_notes", blob) as { v?: unknown; text?: unknown } | null;
  return v && v.v === 1 && typeof v.text === "string" && [...v.text].length <= MAX_NOTE_CHARS ? v.text : null;
}

/** The newest recovery envelope's date, or null when none was made. */
export function recoveryMadeAt(acct: AccountInfo): string | null {
  if (acct.recovery_key_status !== "created") return null;
  return (acct.envelopes ?? []).filter((e) => e.method === "recovery").map((e) => e.created_at).sort().pop() ?? null;
}

export interface CheckRows {
  recovery: { madeAt: string | null };
  devices: { count: number; places: string[] };
  github: boolean;
}

export function checkRows(acct: AccountInfo, githubLinked: boolean): CheckRows {
  const credentials = acct.credentials ?? [];
  return {
    recovery: { madeAt: recoveryMadeAt(acct) },
    devices: { count: credentials.length, places: credentials.map((c) => storagePlace(c.aaguid)) },
    github: githubLinked,
  };
}

/** Only a touch phone that has not added the page to its home screen is told how (UX ⑥-3). */
export const shortcutNeeded = (e: { touch: boolean; narrow: boolean; standalone: boolean }): boolean => e.touch && e.narrow && !e.standalone;
