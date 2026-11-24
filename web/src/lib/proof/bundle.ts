// The proof file the user keeps (spec §15 "local copy": the GitHub bundle.json with the nonce in plain hex and, once there,
// the complete OTS receipt). `verifyBundle` is pure — it never calls a server or GitHub — and is what /verify (7.3) will use.
// The nonce is the key to the fingerprint: it goes only into the file the user downloads, never anywhere else.
import { commit, fromHex, manifest, toHex } from "../commit";
import type { VersionView } from "../model/read-model";
import { claimOf, confirmAnchor, type Explorers } from "./confirm";

export interface LocalBundle {
  v: 1; record_id: string; hash_alg: "sha256-nonce-v1"; commitment: string; nonce: string; manifest: boolean;
  ots_complete: string | null; block_height: number | null; recorded_at: string; engine_id: string; log_seq: string;
}
export type Verdict = "ok" | "mismatch" | "locked" | "pending" | "bad";
export type BundleFile = { path: string; content: Uint8Array };

export const exportName = (recordId: string) => `${recordId}-증명.json`;

/** `nonce` is the opened one; the block height is written only when this browser's own check confirmed it. */
export function exportBundle(v: VersionView, nonce: Uint8Array, many: boolean): LocalBundle {
  return {
    v: 1, record_id: v.recordId, hash_alg: "sha256-nonce-v1", commitment: v.server.commitment, nonce: toHex(nonce), manifest: many,
    ots_complete: v.server.receipt, block_height: v.server.anchor === "confirmed" ? v.server.blockHeight : null,
    recorded_at: v.server.recordedAt, engine_id: v.server.engineId, log_seq: v.server.logSeq,
  };
}

const HEX64 = /^[0-9a-f]{64}$/;
const str = (x: unknown): x is string => typeof x === "string";

interface Parsed { commitment: string; nonce: Uint8Array; manifest: boolean; receipt: string | null }
function parse(raw: unknown): Parsed | "locked" | null {
  const b = raw as Partial<Record<keyof LocalBundle | "nonce_sealed", unknown>> | null;
  if (typeof b !== "object" || b === null || b.v !== 1 || !str(b.commitment) || !HEX64.test(b.commitment)) return null;
  if (b.nonce === undefined && str(b.nonce_sealed)) return "locked"; // the GitHub form: the nonce is sealed to the account key
  if (!str(b.nonce) || !HEX64.test(b.nonce)) return null;
  if (b.ots_complete !== undefined && b.ots_complete !== null && !str(b.ots_complete)) return null;
  return { commitment: b.commitment, nonce: fromHex(b.nonce), manifest: b.manifest === true, receipt: (b.ots_complete as string | null | undefined) ?? null };
}

async function fingerprintOf(nonce: Uint8Array, many: boolean, content: Uint8Array | readonly BundleFile[]): Promise<string | null> {
  try {
    if (!many) return content instanceof Uint8Array ? toHex(await commit(nonce, content)) : null;
    return Array.isArray(content) ? toHex(await commit(nonce, await manifest([...content]))) : null;
  } catch {
    return null; // a path the engine would not have accepted
  }
}

/**
 * ok: the content has the bundle's fingerprint and the receipt holds (with `explorers`: both show the block; without: it leads
 *   to a bitcoin block, which is not looked at). pending: the content fits but there is no complete receipt yet, or the explorers
 *   could not answer. mismatch: other content, or the explorers disagree. locked: the nonce is still sealed. bad: not a bundle,
 *   or the receipt does not hold.
 */
export async function verifyBundle(bundle: unknown, content: Uint8Array | readonly BundleFile[], explorers?: Explorers): Promise<Verdict> {
  const p = parse(bundle);
  if (p === "locked") return "locked";
  if (!p) return "bad";
  try {
    if ((await fingerprintOf(p.nonce, p.manifest, content)) !== p.commitment) return "mismatch";
    if (p.receipt === null) return "pending";
    if (!explorers) return claimOf(fromHex(p.commitment), p.receipt) ? "ok" : "bad";
    const c = await confirmAnchor(fromHex(p.commitment), p.receipt, explorers);
    return { confirmed: "ok", checking: "pending", mismatch: "mismatch", invalid: "bad" }[c.state] as Verdict;
  } finally {
    p.nonce.fill(0);
  }
}

