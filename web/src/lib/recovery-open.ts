// 비상 열쇠로 열기 (spec §11, D10): the typed key finds the sealed envelope, opens it here, proves it is the real key by
// signing the server's 5-minute challenge, and only then may a new device lock be registered. The key, its derived keys and
// seeds are zeroed on every path; the key itself is never sent anywhere.
import { fromB64u } from "@ideatrail/crypto/bytes";
import { recoveryLookupId, recoveryVerifyKey, recoveryWrapKey, unwrapMasterKey } from "@ideatrail/crypto/envelope";
import { recoveryProofMessage } from "@ideatrail/crypto/message";
import { parseRecoveryKey } from "@ideatrail/crypto/recovery";
import { sign } from "@ideatrail/crypto/sign";
import { ApiFailure, type Api, type RegisterOptions } from "./api";
import { COPY } from "./copy";
import { failureCode } from "./unlock";
import { makeEnvelope } from "./signup/account";
import { registrationJSON, type Created } from "./webauthn";

export type RecoveryReason = "format" | "not_found" | "wrong_key" | "expired" | "offline" | "failed";

export class RecoveryFailure extends Error {
  constructor(readonly reason: RecoveryReason) {
    super(reason);
    this.name = "RecoveryFailure";
  }
}

/** The master key lives here until `finishRecovery` or `abandonRecovery` wipes it. */
export interface RecoveryState { userId: string; mk: Uint8Array; options: RegisterOptions }

function apiReason(e: unknown): RecoveryFailure {
  if (!(e instanceof ApiFailure)) return new RecoveryFailure("failed");
  if (e.code === "offline") return new RecoveryFailure("offline");
  if (e.code === "recovery_not_found") return new RecoveryFailure("not_found");
  if (e.code === "challenge_invalid") return new RecoveryFailure("expired");
  if (e.code === "recovery_proof_failed") return new RecoveryFailure("wrong_key");
  return new RecoveryFailure("failed");
}

/** What the server said about a failed register/verify, for the screen. */
export const recoveryReason = (e: unknown): RecoveryReason => (e instanceof RecoveryFailure ? e.reason : apiReason(e).reason);

/** Typed key → opened master key and fresh registration options. Throws RecoveryFailure; nothing secret leaves in an error. */
export async function startRecovery(api: Api, typed: string): Promise<RecoveryState> {
  let rk: Uint8Array;
  try {
    rk = parseRecoveryKey(typed);
  } catch {
    throw new RecoveryFailure("format");
  }
  const temp: Uint8Array[] = [rk];
  let mk: Uint8Array | null = null;
  try {
    const found = await api.recoveryEnvelope({ lookup_id: recoveryLookupId(rk) }).catch((e: unknown) => { throw apiReason(e); });
    const wrap = recoveryWrapKey(rk, found.user_id);
    temp.push(wrap);
    try {
      mk = unwrapMasterKey(wrap, found.user_id, found.envelope.envelope_id, fromB64u(found.envelope.wrapped_master_key));
    } catch {
      throw new RecoveryFailure("wrong_key"); // one reason for any failure to open: no oracle
    }
    const verify = recoveryVerifyKey(rk);
    temp.push(verify.seed);
    const proof = sign(verify.seed, recoveryProofMessage(found.challenge));
    const options = await api.registerOptions({ recovery_challenge_id: found.recovery_challenge_id, proof }).catch((e: unknown) => { throw apiReason(e); });
    if (options.user_id !== found.user_id) throw new RecoveryFailure("failed"); // the server must not switch accounts mid-way
    return { userId: found.user_id, mk, options };
  } catch (e) {
    mk?.fill(0);
    throw e;
  } finally {
    for (const t of temp) t.fill(0);
  }
}

export function abandonRecovery(s: RecoveryState): void {
  s.mk.fill(0);
}

/** The new device lock: its own envelope (unwrapped once before upload), then register. The master key is wiped either way. */
export async function finishRecovery(api: Api, s: RecoveryState, created: Created, prf: Uint8Array): Promise<void> {
  try {
    const envelope = makeEnvelope(s.mk, s.userId, prf, created.rawId);
    await api.registerVerify({ challenge_id: s.options.challenge_id, response: registrationJSON(created.credential), envelope });
  } finally {
    abandonRecovery(s);
    prf.fill(0);
  }
}

/** Screen text for a failed new device lock. InvalidStateError = the chosen authenticator already holds a lock for this
 * account (excludeCredentials) — G2 2026-11-25, Windows Chrome offered the phone. Anything else shows its name only. */
export function lockCreateError(e: unknown): string {
  if (e instanceof DOMException && e.name === "InvalidStateError") return COPY.errors.already_here;
  if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError")) return COPY.errors.passkey_cancel;
  return `${COPY.errors.generic} (${COPY.dash.errorCode} ${failureCode(e)})`;
}
