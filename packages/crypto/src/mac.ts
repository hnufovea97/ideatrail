import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concat, utf8 } from "./bytes";

const KEY_LEN = 32;
const LABEL_PAIR = "ideatrail/v1/pair";
const LABEL_DA_JOIN = "ideatrail/v1/da-join";
const LABEL_DA_KEY = "ideatrail/v1/da-key";

function mac(key: Uint8Array, label: string, sessionId: string, data: Uint8Array): Uint8Array {
  if (key.length !== KEY_LEN) throw new Error("bad_key");
  return hmac(sha256, key, concat(utf8(label), utf8(sessionId), data));
}

/** Pairing handoff MAC (spec §9-4): HMAC-SHA256(psk, "ideatrail/v1/pair" ‖ session_id ‖ payload). */
export const pairMac = (psk: Uint8Array, sessionId: string, payload: Uint8Array): Uint8Array => mac(psk, LABEL_PAIR, sessionId, payload);

/** Device-add join MAC (spec §10-2): HMAC-SHA256(qpsk, "ideatrail/v1/da-join" ‖ d ‖ t_pub). */
export const deviceJoinMac = (qpsk: Uint8Array, d: string, tPub: Uint8Array): Uint8Array => mac(qpsk, LABEL_DA_JOIN, d, tPub);

/** Device-add key MAC (spec §10-3): HMAC-SHA256(qpsk, "ideatrail/v1/da-key" ‖ d ‖ sealed). */
export const deviceKeyMac = (qpsk: Uint8Array, d: string, sealed: Uint8Array): Uint8Array => mac(qpsk, LABEL_DA_KEY, d, sealed);

/** Constant-time equality for MACs and keys (length is not secret). */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
