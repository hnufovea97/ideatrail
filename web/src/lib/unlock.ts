// Login = unlock (UX: "기기 잠금 한 번 = 로그인 + 열쇠 풀기", spec §11). The keys live only in the returned object,
// in memory, until wipeVault. Every temporary key (PRF output, wrap key, subkey) is zeroed right after use.
import { fromB64u } from "@ideatrail/crypto/bytes";
import { prfWrapKey, unwrapMasterKey } from "@ideatrail/crypto/envelope";
import { kemPublicOf } from "@ideatrail/crypto/keypair";
import { bytesEqual } from "@ideatrail/crypto/mac";
import { unlock } from "@ideatrail/crypto/relock";
import { subkey } from "@ideatrail/crypto/subkey";
import { ApiFailure, type AccountInfo, type Api, type LoginOptions } from "./api";
import { isRollback, openEngineList, rememberVersion, type EngineList, type VersionStore } from "./engine-list";
import type { Vault } from "./signup/account";
import { LOGIN_REFRESH_MS } from "./timing";
import { assertWithPrf, type Unlocked } from "./webauthn";

export const DEFAULT_LOCK_MINUTES = 5;
const MIN_LOCK_MINUTES = 1;

export interface DashboardVault extends Vault { engineList: EngineList; autoLockMinutes: number }

export type UnlockReason = "passkey_cancel" | "prf_missing" | "not_registered" | "retry" | "offline" | "account_mismatch" | "engine_list_rollback" | "failed";

export class UnlockFailure extends Error {
  constructor(readonly reason: UnlockReason) {
    super(reason);
    this.name = "UnlockFailure";
  }
}

/** `preparedAt` (ms): the server challenge expires, so options older than LOGIN_REFRESH_MS are fetched again before get. */
export interface PreparedLogin extends LoginOptions { preparedAt: number }

/** Fetched before the click (Safari: no await between the click and get). */
export const prepareLogin = async (api: Api, now: () => number = Date.now): Promise<PreparedLogin> => ({ ...(await api.loginOptions()), preparedAt: now() });

export const isFresh = (p: PreparedLogin, now: number = Date.now()): boolean => now - p.preparedAt < LOGIN_REFRESH_MS;

/** A vault that opened after its screen went away is wiped at once instead of being handed over. */
export function settleOpened(alive: boolean, v: DashboardVault, onOpen: (v: DashboardVault) => void): void {
  if (alive) onOpen(v);
  else wipeVault(v);
}

/** Call straight from the click handler. */
export const askPasskey = (p: PreparedLogin, nav?: CredentialsContainer): Promise<Unlocked> => assertWithPrf(p.options, nav);

/** Zero the secrets in place (the one deliberate mutation: memory must not keep them). */
export function wipeVault(v: Vault): void {
  v.mk.fill(0);
  v.akPriv.fill(0);
}

/** The server's users.auto_lock_minutes may only shorten the default (an unread server value must not keep keys longer). */
const clampMinutes = (m: unknown): number =>
  typeof m === "number" && Number.isInteger(m) ? Math.min(DEFAULT_LOCK_MINUTES, Math.max(MIN_LOCK_MINUTES, m)) : DEFAULT_LOCK_MINUTES;

const UNKNOWN_PASSKEY = "webauthn_failed"; // api/src/auth/webauthn.ts: an unknown credential (or a failed check) on login
const STALE_CHALLENGE = "challenge_invalid"; // api/src/auth/challenges.ts: expired or already used

/** Login verify: only the server's unknown-passkey code means "not registered"; a stale challenge or 429 can be retried. */
function verifyReason(e: unknown): UnlockFailure {
  if (!(e instanceof ApiFailure)) return new UnlockFailure("failed");
  if (e.code === "offline") return new UnlockFailure("offline");
  if (e.code === UNKNOWN_PASSKEY) return new UnlockFailure("not_registered");
  if (e.code === STALE_CHALLENGE || e.status === 429) return new UnlockFailure("retry");
  return new UnlockFailure("failed");
}

function apiReason(e: unknown): UnlockFailure {
  return new UnlockFailure(e instanceof ApiFailure && e.code === "offline" ? "offline" : "failed");
}

async function openMasterKey(api: Api, p: PreparedLogin, got: Unlocked): Promise<{ userId: string; mk: Uint8Array }> {
  const prf = got.prf;
  if (!prf) throw new UnlockFailure("prf_missing");
  try {
    const login = await api.loginVerify({ challenge_id: p.challenge_id, response: got.assertion }).catch((e: unknown) => { throw verifyReason(e); });
    const wrap = prfWrapKey(prf, got.rawId);
    try {
      return { userId: login.user_id, mk: unwrapMasterKey(wrap, login.user_id, login.envelope.envelope_id, fromB64u(login.envelope.wrapped_master_key)) };
    } catch {
      throw new UnlockFailure("failed"); // decrypt_failed: one reason, no oracle
    } finally {
      wrap.fill(0);
    }
  } finally {
    prf.fill(0);
  }
}

/** The account public key, or null when it differs from the server's (or either one is malformed). */
function matchingPublic(akPriv: Uint8Array, serverPub: string) {
  try {
    const akPub = kemPublicOf(akPriv);
    return bytesEqual(akPub, fromB64u(serverPub)) ? akPub : null;
  } catch {
    return null;
  }
}

function openAccountKey(mk: Uint8Array, userId: string, acct: AccountInfo): { akPriv: Uint8Array; akPub: Uint8Array } {
  if (acct.user_id !== userId || !acct.account_pubkey || !acct.wrapped_account_privkey) throw new UnlockFailure("account_mismatch");
  const k = subkey(mk, "account_priv");
  let akPriv: Uint8Array;
  try {
    akPriv = unlock(k, "account_priv", { userId }, fromB64u(acct.wrapped_account_privkey));
  } catch {
    throw new UnlockFailure("account_mismatch");
  } finally {
    k.fill(0);
  }
  const akPub = matchingPublic(akPriv, acct.account_pubkey);
  if (!akPub) {
    akPriv.fill(0);
    throw new UnlockFailure("account_mismatch"); // the server swapped the public key engines seal to
  }
  return { akPriv, akPub };
}

function openList(mk: Uint8Array, userId: string, acct: AccountInfo, store: VersionStore): EngineList {
  const version = acct.engine_list_version;
  if (isRollback(store, userId, version)) throw new UnlockFailure("engine_list_rollback");
  if (!acct.engine_list) {
    if (version !== 0) throw new UnlockFailure("failed");
    return { v: 1, version: 0, engines: [] };
  }
  let list: EngineList;
  try {
    list = openEngineList(mk, userId, version, acct.engine_list);
  } catch {
    throw new UnlockFailure("failed");
  }
  rememberVersion(store, userId, version);
  return list;
}

/** After the passkey: verify on the server, unwrap MK, open the account key and the engine list. */
export async function openVault(api: Api, p: PreparedLogin, got: Unlocked, store: VersionStore): Promise<DashboardVault> {
  const { userId, mk } = await openMasterKey(api, p, got);
  try {
    const acct = await api.account().catch((e: unknown) => { throw apiReason(e); });
    const { akPriv, akPub } = openAccountKey(mk, userId, acct);
    try {
      return { userId, mk, akPriv, akPub, engineList: openList(mk, userId, acct, store), autoLockMinutes: clampMinutes(acct.auto_lock_minutes) };
    } catch (e) {
      akPriv.fill(0);
      throw e;
    }
  } catch (e) {
    mk.fill(0);
    throw e;
  }
}

export function unlockReason(e: unknown): UnlockReason {
  if (e instanceof UnlockFailure) return e.reason;
  if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError")) return "passkey_cancel";
  return "failed";
}

const CODE_NAME = /^[A-Za-z_]{1,40}$/;
/** A short, safe label for an unexpected failure (the error's name only, never its message), shown so a phone report can be traced. */
export function failureCode(e: unknown): string {
  const name = e instanceof Error || e instanceof DOMException ? e.name : "";
  return CODE_NAME.test(name) ? name : "unknown";
}
