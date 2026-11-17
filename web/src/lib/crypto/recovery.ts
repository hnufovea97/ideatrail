import { CROCKFORD, encodeBase32 } from "./ids";

const RK_BYTES = 32;
const RK_CHARS = 52; // ceil(256 / 5); the last char carries 4 zero bits
const GROUP = 4;

/** 32 bytes → 52 Crockford chars in 13 groups of 4, joined by "-". */
export function formatRecoveryKey(rk: Uint8Array): string {
  if (rk.length !== RK_BYTES) throw new Error("bad_recovery_key");
  const s = encodeBase32(rk);
  const groups: string[] = [];
  for (let i = 0; i < s.length; i += GROUP) groups.push(s.slice(i, i + GROUP));
  return groups.join("-");
}

/** Accepts any case, spaces or hyphens, and Crockford look-alikes (i/l → 1, o → 0). */
export function parseRecoveryKey(input: string): Uint8Array {
  const s = input.toLowerCase().replace(/[\s-]/g, "").replace(/[il]/g, "1").replace(/o/g, "0");
  if (s.length !== RK_CHARS) throw new Error("bad_recovery_key");
  const out = new Uint8Array(RK_BYTES);
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (const c of s) {
    const v = CROCKFORD.indexOf(c);
    if (v < 0) throw new Error("bad_recovery_key");
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
    acc &= (1 << bits) - 1;
  }
  if (acc !== 0) throw new Error("bad_recovery_key");
  return out;
}
