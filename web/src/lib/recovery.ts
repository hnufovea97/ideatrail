import { toB64u } from "@ideatrail/crypto/bytes";
import { lookupHash, recoveryLookupId, recoveryVerifyKey, recoveryWrapKey, unwrapMasterKey, wrapMasterKey } from "@ideatrail/crypto/envelope";
import { newId } from "@ideatrail/crypto/ids";
import { randomKey } from "@ideatrail/crypto/keypair";
import { bytesEqual } from "@ideatrail/crypto/mac";
import { formatRecoveryKey, parseRecoveryKey } from "@ideatrail/crypto/recovery";
import type { RecoveryBody } from "./api";
import type { Vault } from "./signup/account";

/** What the screen shows and what the server stores. The raw RK is not kept beyond this function. */
export interface RecoveryPlan { display: string; body: RecoveryBody }

export function makeRecovery(v: Vault): RecoveryPlan {
  const rk = randomKey();
  const envelopeId = newId();
  const wrapped = wrapMasterKey(recoveryWrapKey(rk, v.userId), v.mk, v.userId, envelopeId);
  const display = formatRecoveryKey(rk).toUpperCase();
  const back = unwrapMasterKey(recoveryWrapKey(parseRecoveryKey(display), v.userId), v.userId, envelopeId, wrapped); // spec §11: unwrap once before upload
  if (!bytesEqual(back, v.mk)) throw new Error("unwrap_check_failed");
  return {
    display,
    body: {
      envelope_id: envelopeId,
      method: "recovery",
      wrapped_master_key: toB64u(wrapped),
      lookup_hash: lookupHash(recoveryLookupId(rk)),
      verify_pubkey: toB64u(recoveryVerifyKey(rk).publicKey),
    },
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[\s-]/g, "").replace(/[il]/g, "1").replace(/o/g, "0");

/** Spec §11: compared in the browser only — never sent. */
export function firstFourMatches(display: string, typed: string): boolean {
  const want = norm(display).slice(0, 4);
  return want.length === 4 && norm(typed) === want;
}
