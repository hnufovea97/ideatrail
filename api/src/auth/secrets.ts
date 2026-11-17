import { toB64u, toHex } from "@ideatrail/crypto/bytes";

export const sha256Hex = async (data: Uint8Array | string): Promise<string> =>
  toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", typeof data === "string" ? new TextEncoder().encode(data) : data)));

export const randomToken = (bytes = 32): string => toB64u(crypto.getRandomValues(new Uint8Array(bytes)));

/** Constant-time comparison of two equal-length hex/ascii strings. */
export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyEd25519Raw(pub: Uint8Array, msg: Uint8Array, sig: Uint8Array): Promise<boolean> {
  if (pub.length !== 32 || sig.length !== 64) return false;
  try {
    const key = await crypto.subtle.importKey("raw", pub, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, sig, msg);
  } catch {
    return false;
  }
}
