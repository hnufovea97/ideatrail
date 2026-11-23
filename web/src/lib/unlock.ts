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
import { assertWithPrf, type Unlocked } from "./webauthn";

export const DEFAULT_LOCK_MINUTES = 5;
const MIN_LOCK_MINUTES = 1;
const MAX_LOCK_MINUTES = 60;

export interface DashboardVault extends Vault { engineList: EngineList; autoLockMinutes: number }

export type UnlockReason = "passkey_cancel" | "prf_missing" | "not_registered" | "offline" | "account_mismatch" | "engine_list_rollback" | "failed";

export class UnlockFailure extends Error {
  constructor(readonly reason: UnlockReason) {
    super(reason);
    this.name = "UnlockFailure";
  }
}

export type PreparedLogin = LoginOptions;

/** Fetched before the click (Safari: no await between the click and get). */
export const prepareLogin = (api: Api): Promise<PreparedLogin> => api.loginOptions();

/** Call straight from the click handler. */
export const askPasskey = (p: PreparedLogin, nav?: CredentialsContainer): Promise<Unlocked> => assertWithPrf(p.options, nav);

/** Zero the secrets in place (the one deliberate mutation: memory must not keep them). */
export function wipeVault(v: Vault): void {
  v.mk.fill(0);
  v.akPriv.fill(0);
}

const clampMinutes = (m: unknown): number =>
  Number.isInteger(m) ? Math.min(MAX_LOCK_MINUTES, Math.max(MIN_LOCK_MINUTES, m as number)) : DEFAULT_LOCK_MINUTES;

function apiReason(e: unknown, refused: UnlockReason): UnlockFailure {
  if (e instanceof ApiFailure && e.code === "offline") return new UnlockFailure("offline");
  if (e instanceof ApiFailure && e.status >= 400 && e.status < 500) return new UnlockFailure(refused);
  return new UnlockFailure("failed");
}

async function openMasterKey(api: Api, p: PreparedLogin, got: Unlocked): Promise<{ userId: string; mk: Uint8Array }> {
  const prf = got.prf;
  if (!prf) throw new UnlockFailure("prf_missing");
  try {
    const login = await api.loginVerify({ challenge_id: p.challenge_id, response: got.assertion }).catch((e: unknown) => { throw apiReason(e, "not_registered"); });
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
  const akPub = kemPublicOf(akPriv);
  if (!bytesEqual(akPub, fromB64u(acct.account_pubkey))) {
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
    const acct = await api.account().catch((e: unknown) => { throw apiReason(e, "failed"); });
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
