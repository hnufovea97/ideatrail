const enc = new TextEncoder();
const TAG = enc.encode("ideatrail/sha256-nonce-v1\0");
const MTAG = enc.encode("ideatrail/manifest-v1\0");

/** 16진수 문자열 → 바이트. 짝수 길이·0-9a-fA-F만 허용, 아니면 invalid_hex (조용히 잘못된 값을 만들지 않는다) */
export function fromHex(h: string): Uint8Array {
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(h)) throw new Error("invalid_hex");
  return new Uint8Array((h.match(/../g) ?? []).map((x) => parseInt(x, 16)));
}
export const toHex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
const u64 = (n: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n)); return b; };
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
// TS 5.7+는 Uint8Array<ArrayBufferLike>를 BufferSource로 받지 않아 캐스트가 필요하다
const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", b as Uint8Array<ArrayBuffer>));

/** 설계문서 §3.1.10 A — 엔진(Go)과 같은 결과를 내야 한다 */
export async function commit(nonce: Uint8Array, content: Uint8Array): Promise<Uint8Array> {
  return sha256(concat(TAG, u32(nonce.length), nonce, u64(content.length), content));
}

const byteCompare = (a: Uint8Array, b: Uint8Array) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
};

/** 암호-통신-규격 §7 경로 규칙: 잘못된 유니코드는 오류, NFC, `\`→`/`, 빈 조각(앞뒤 `/`)·`.`·`..` 조각이면 오류, 대소문자 그대로 */
export function normalizePath(p: string): string {
  if (!p.isWellFormed()) throw new Error("invalid_path"); // 외톨이 서로게이트 = Go의 잘못된 UTF-8
  const q = p.normalize("NFC").replaceAll("\\", "/");
  if (q.split("/").some((s) => s === "" || s === "." || s === "..")) throw new Error("invalid_path");
  return q;
}

/** 정규화 뒤 같은 경로가 둘이면 duplicate_path. 파일 내용 바이트는 바꾸지 않는다 */
export async function manifest(entries: { path: string; content: Uint8Array }[]): Promise<Uint8Array> {
  const es = entries.map((e) => ({ p: enc.encode(normalizePath(e.path)), c: e.content })).sort((x, y) => byteCompare(x.p, y.p));
  for (let i = 1; i < es.length; i++) if (byteCompare(es[i - 1].p, es[i].p) === 0) throw new Error("duplicate_path");
  const parts: Uint8Array[] = [MTAG, u32(es.length)];
  for (const e of es) parts.push(u32(e.p.length), e.p, await sha256(e.c));
  return concat(...parts);
}
