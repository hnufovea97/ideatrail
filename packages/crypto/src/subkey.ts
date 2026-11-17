import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8 } from "./bytes";

export const KEY_LEN = 32;

/** subkey(p) = HKDF-SHA256(ikm=MK, salt="", info="ideatrail/v1/subkey/"+p) — spec §3. */
export function subkey(mk: Uint8Array, purpose: string): Uint8Array {
  if (mk.length !== KEY_LEN) throw new Error("bad_key");
  return hkdf(sha256, mk, new Uint8Array(0), utf8("ideatrail/v1/subkey/" + purpose), KEY_LEN);
}
