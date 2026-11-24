// vitest/e2e only — never import from app code. What the engine puts in the repo for one record (spec §12):
// proofs/<id>/bundle.json (GitHub form, nonce sealed with kind 5) and proofs/<id>/original.it1 (kind 3).
import { toB64u, utf8 } from "@ideatrail/crypto/bytes";
import { newId } from "@ideatrail/crypto/ids";
import { randomKey } from "@ideatrail/crypto/keypair";
import { KIND, seal } from "@ideatrail/crypto/seal";
import { commit, manifest, toHex } from "../commit";
import type { VersionRef } from "../versions/original";

export interface ProofFile { path: string; bytes: Uint8Array }
export interface Proof { ref: VersionRef; repo: Record<string, Uint8Array>; nonce: Uint8Array }

const BLOCK = 512;
const pad = (n: number) => (BLOCK - (n % BLOCK)) % BLOCK;
function header(name: string, size: number, flag: string): Uint8Array {
  const h = new Uint8Array(BLOCK);
  h.set(utf8(name).subarray(0, 100), 0);
  h.set(utf8(`${size.toString(8).padStart(11, "0")}\0`), 124);
  h[156] = flag.charCodeAt(0);
  return h;
}
const cat = (parts: Uint8Array[]) => { const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { o.set(p, at); at += p.length; } return o; };

/** As engine tarOf: sorted names, regular files, a PAX "path" record when the name is not plain ASCII. */
export function tarOf(files: readonly ProofFile[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    if (/[^\x20-\x7e]/.test(f.path)) {
      let rec = ""; // the record length counts its own digits: try until it settles
      for (let n = utf8(` path=${f.path}\n`).length + 1; ; n++) { rec = `${n} path=${f.path}\n`; if (utf8(rec).length === n) break; }
      const data = utf8(rec);
      parts.push(header("PaxHeader", data.length, "x"), data, new Uint8Array(pad(data.length)));
    }
    parts.push(header(f.path, f.bytes.length, "0"), f.bytes, new Uint8Array(pad(f.bytes.length)));
  }
  parts.push(new Uint8Array(BLOCK * 2));
  return cat(parts);
}

/** `original: false` = a big/picture file (fingerprint only). `commitment` overrides the one written into bundle.json. */
export async function makeProof(userAk: Uint8Array, userId: string, o: { rootId?: string; recordId?: string; files: readonly ProofFile[]; original?: boolean; bundleCommitment?: string }): Promise<Proof> {
  const rootId = o.rootId ?? newId();
  const recordId = o.recordId ?? newId();
  const nonce = randomKey();
  const many = o.files.length > 1;
  const content = many ? await manifest(o.files.map((f) => ({ path: f.path, content: f.bytes }))) : o.files[0].bytes;
  const commitment = toHex(await commit(nonce, content));
  const aad = { userId, rootId, recordId, version: "0" };
  const bundle = { v: 1, record_id: recordId, hash_alg: "sha256-nonce-v1", commitment: o.bundleCommitment ?? commitment, nonce_sealed: toB64u(await seal(KIND.nonce, userAk, aad, nonce)), manifest: many, ots: [] };
  const repo: Record<string, Uint8Array> = { [`proofs/${recordId}/bundle.json`]: utf8(JSON.stringify(bundle)) };
  if (o.original !== false) repo[`proofs/${recordId}/original.it1`] = await seal(KIND.original, userAk, aad, many ? tarOf(o.files) : o.files[0].bytes);
  return { ref: { recordId, rootId, commitment, mainFile: o.files[0].path }, repo, nonce };
}
