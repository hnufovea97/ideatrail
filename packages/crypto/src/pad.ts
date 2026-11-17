const STEPS = [256, 512, 1024, 2048, 4096];
const BLOCK = 4096;

/** Target length for n plaintext bytes (spec §6). */
export function paddedLen(n: number): number {
  const need = n + 1;
  for (const s of STEPS) if (need <= s) return s;
  return Math.ceil(need / BLOCK) * BLOCK;
}

/** ISO/IEC 7816-4: 0x80 then zeros. */
export function pad(p: Uint8Array): Uint8Array {
  const out = new Uint8Array(paddedLen(p.length));
  out.set(p);
  out[p.length] = 0x80;
  return out;
}

export function unpad(p: Uint8Array): Uint8Array {
  for (let i = p.length - 1; i >= 0; i--) {
    if (p[i] === 0) continue;
    if (p[i] === 0x80 && paddedLen(i) === p.length) return p.subarray(0, i);
    break;
  }
  throw new Error("bad_padding");
}
