// Reads the tar the engine packs for a many-file record (engine/internal/record/files.go tarOf): regular files only,
// names in the header or in a PAX "path" record. Anything else is "not what the engine wrote" (null).
export interface TarFile { path: string; content: Uint8Array }

export const MAX_TAR_ENTRIES = 5000;
const BLOCK = 512;
const dec = new TextDecoder("utf-8", { fatal: true });

const cstr = (b: Uint8Array) => { const z = b.indexOf(0); return dec.decode(z < 0 ? b : b.subarray(0, z)); };
function octal(b: Uint8Array): number | null {
  const s = cstr(b).trim();
  return /^[0-7]+$/.test(s) ? parseInt(s, 8) : null;
}

/** "<len> key=value\n" records; returns the ones this reader uses. */
function pax(data: Uint8Array): { path?: string } | null {
  const out: { path?: string } = {};
  let at = 0;
  while (at < data.length) {
    const sp = data.indexOf(0x20, at);
    const n = sp < 0 ? NaN : Number(dec.decode(data.subarray(at, sp)));
    if (!Number.isInteger(n) || n <= sp - at + 1 || at + n > data.length || data[at + n - 1] !== 0x0a) return null;
    const rec = dec.decode(data.subarray(sp + 1, at + n - 1));
    const eq = rec.indexOf("=");
    if (eq > 0 && rec.slice(0, eq) === "path") out.path = rec.slice(eq + 1);
    at += n;
  }
  return out;
}

export function untar(bytes: Uint8Array): TarFile[] | null {
  try {
    const files: TarFile[] = [];
    let at = 0;
    let nextPath: string | undefined;
    while (at + BLOCK <= bytes.length) {
      const h = bytes.subarray(at, at + BLOCK);
      if (h.every((x) => x === 0)) return files; // end marker
      const size = octal(h.subarray(124, 136));
      const flag = h[156];
      if (size === null || at + BLOCK + size > bytes.length) return null;
      const data = bytes.subarray(at + BLOCK, at + BLOCK + size);
      at += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
      if (flag === 0x78) { // 'x': PAX header for the next entry
        const p = pax(data);
        if (!p) return null;
        nextPath = p.path;
      } else if (flag === 0x30 || flag === 0) { // regular file
        const prefix = cstr(h.subarray(345, 500));
        const name = nextPath ?? (prefix ? `${prefix}/${cstr(h.subarray(0, 100))}` : cstr(h.subarray(0, 100)));
        nextPath = undefined;
        if (files.length >= MAX_TAR_ENTRIES) return null;
        files.push({ path: name, content: data.slice() });
      } else {
        return null;
      }
    }
    return null; // no end marker
  } catch {
    return null;
  }
}
