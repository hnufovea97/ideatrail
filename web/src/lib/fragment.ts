import { fromB64u } from "@ideatrail/crypto/bytes";
import { bytesEqual } from "@ideatrail/crypto/mac";
import type { PairingInfo } from "./api";
import { cleanLabel } from "./text";

const ID = /^[0-9a-hjkmnp-tv-z]{26}$/;
const KEY_LEN = 32;
const MAX_NAME = 64;

export interface PairingLink { sessionId: string; signFp: Uint8Array; kemFp: Uint8Array; psk: Uint8Array; computerName: string }

function b64(s: string | undefined, len?: number): Uint8Array | null {
  try {
    const b = fromB64u(s ?? "");
    return len === undefined || b.length === len ? b : null;
  } catch {
    return null;
  }
}

/** `/start?s=<id>#v1.<sha256 sign_pub>.<sha256 kem_pub>.<psk>.<computer name>` (spec §9-2). */
export function parseStartLink(search: string, hash: string): PairingLink | null {
  const sessionId = new URLSearchParams(search).get("s") ?? "";
  const parts = hash.replace(/^#/, "").split(".");
  if (!ID.test(sessionId) || parts.length !== 5 || parts[0] !== "v1") return null;
  const [signFp, kemFp, psk, rawName] = [b64(parts[1], KEY_LEN), b64(parts[2], KEY_LEN), b64(parts[3], KEY_LEN), b64(parts[4])];
  if (!signFp || !kemFp || !psk || !rawName) return null;
  let name: string;
  try {
    name = cleanLabel(new TextDecoder("utf-8", { fatal: true }).decode(rawName), MAX_NAME);
  } catch {
    return null;
  }
  return name ? { sessionId, signFp, kemFp, psk, computerName: name } : null;
}

/** `/connect?d=<id>#v1.<qpsk>` (spec §10-1). */
export function parseConnectLink(search: string, hash: string): { d: string; qpsk: Uint8Array } | null {
  const d = new URLSearchParams(search).get("d") ?? "";
  const parts = hash.replace(/^#/, "").split(".");
  const qpsk = parts.length === 2 && parts[0] === "v1" ? b64(parts[1], KEY_LEN) : null;
  return ID.test(d) && qpsk ? { d, qpsk } : null;
}

const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", b.slice().buffer));

/** Spec §9-3: the server's two engine keys must hash to the link's fingerprints, or signup stops. */
export async function engineKeysMatch(link: PairingLink, info: PairingInfo): Promise<{ signPub: Uint8Array; kemPub: Uint8Array } | null> {
  const signPub = b64(info.sign_pubkey, KEY_LEN);
  const kemPub = b64(info.kem_pubkey, KEY_LEN);
  if (!signPub || !kemPub) return null;
  const ok = bytesEqual(await sha256(signPub), link.signFp) && bytesEqual(await sha256(kemPub), link.kemFp);
  return ok ? { signPub, kemPub } : null;
}

/** Drop the secret fragment from the address bar (and history) once it has been read. */
export function clearFragment(): void {
  history.replaceState(null, "", location.pathname + location.search);
}
