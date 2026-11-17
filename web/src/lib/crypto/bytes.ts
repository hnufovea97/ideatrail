export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function fromHex(h: string): Uint8Array {
  if (h.length % 2 !== 0 || /[^0-9a-f]/i.test(h)) throw new Error("bad_hex");
  return Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function toB64u(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Canonical base64url without padding; non-canonical trailing bits are rejected (matches Go Strict). */
export function fromB64u(s: string): Uint8Array {
  if (/[^A-Za-z0-9_-]/.test(s) || s.length % 4 === 1) throw new Error("bad_b64u");
  let out: Uint8Array;
  try {
    out = Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  } catch {
    throw new Error("bad_b64u");
  }
  if (toB64u(out) !== s) throw new Error("bad_b64u");
  return out;
}

/** Copy into a standalone ArrayBuffer (WebCrypto and @hpke APIs take ArrayBuffer). */
export const ab = (b: Uint8Array): ArrayBuffer => b.slice().buffer;
