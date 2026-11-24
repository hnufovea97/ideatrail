import { toB64u } from "@ideatrail/crypto/bytes";
import { lookupHash, recoveryLookupId, recoveryVerifyKey, recoveryWrapKey, unwrapMasterKey, wrapMasterKey } from "@ideatrail/crypto/envelope";
import { newId } from "@ideatrail/crypto/ids";
import { randomKey } from "@ideatrail/crypto/keypair";
import { bytesEqual } from "@ideatrail/crypto/mac";
import { formatRecoveryKey, parseRecoveryKey } from "@ideatrail/crypto/recovery";
import type { RecoveryBody } from "./api";
import { assertLive } from "./live-key";
import type { Vault } from "./signup/account";

/** What the screen shows and what the server stores. The raw RK is not kept beyond this function. */
export interface RecoveryPlan { display: string; body: RecoveryBody }

/** Every temporary key (the raw key, both wrap keys, the proof seed, the checked copy of the master key) is zeroed on every path. */
export function makeRecovery(v: Vault): RecoveryPlan {
  assertLive(v.mk); // a vault wiped by the lock must not make a key
  const temp: Uint8Array[] = [];
  try {
    const rk = randomKey();
    temp.push(rk);
    const envelopeId = newId();
    const wrap = recoveryWrapKey(rk, v.userId);
    temp.push(wrap);
    const wrapped = wrapMasterKey(wrap, v.mk, v.userId, envelopeId);
    const display = formatRecoveryKey(rk).toUpperCase();
    const typed = parseRecoveryKey(display);
    temp.push(typed);
    const typedWrap = recoveryWrapKey(typed, v.userId);
    temp.push(typedWrap);
    const back = unwrapMasterKey(typedWrap, v.userId, envelopeId, wrapped); // spec §11: unwrap once before upload
    temp.push(back);
    if (!bytesEqual(back, v.mk)) throw new Error("unwrap_check_failed");
    const verify = recoveryVerifyKey(rk);
    temp.push(verify.seed);
    return {
      display,
      body: {
        envelope_id: envelopeId,
        method: "recovery",
        wrapped_master_key: toB64u(wrapped),
        lookup_hash: lookupHash(recoveryLookupId(rk)),
        verify_pubkey: toB64u(verify.publicKey),
      },
    };
  } finally {
    for (const t of temp) t.fill(0);
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[\s-]/g, "").replace(/[il]/g, "1").replace(/o/g, "0");

/** Spec §11: compared in the browser only — never sent. */
export function firstFourMatches(display: string, typed: string): boolean {
  const want = norm(display).slice(0, 4);
  return want.length === 4 && norm(typed) === want;
}
