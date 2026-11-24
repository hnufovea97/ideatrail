// Opens a version's original from GitHub (5.6) and checks it is the one the engine signed for: the sealed nonce and
// original are opened with the account key, then the fingerprint is recomputed and compared with the SIGNED commitment
// of the server row (bundle.json is only a copy, never the judge). Everything opened stays in memory.
import { fromB64u } from "@ideatrail/crypto/bytes";
import { KIND, open } from "@ideatrail/crypto/seal";
import type { Fetch } from "../api";
import { commit, manifest, toHex } from "../commit";
import { readRepoFile, type RepoAccess } from "../mirror/github";
import type { DashboardVault } from "../unlock";
import type { GithubBundle } from "./bundle";
import { untar } from "./tar";

export interface OriginalFile { path: string; bytes: Uint8Array }
export type Opened =
  | { kind: "no_original" } // big or picture files: GitHub holds the fingerprint only
  | { kind: "mismatch" } // bundle.json is not this record's
  | { kind: "unreadable" } // does not open, or is not what the engine writes
  | { kind: "opened"; same: boolean; files: readonly OriginalFile[]; nonce: Uint8Array; manifest: boolean }; // same = fingerprint equals the signed one; nonce stays in memory for the user's own proof download only

/** What of a VersionView the opening needs; `commitment` is the engine-signed one. */
export interface VersionRef { recordId: string; rootId: string; commitment: string; mainFile: string | null }
export interface OpenDeps { vault: Pick<DashboardVault, "userId" | "akPriv">; github: Fetch; signal?: AbortSignal }

const SINGLE_FALLBACK_NAME = "-";
export const originalPath = (recordId: string) => `proofs/${recordId}/original.it1`;

async function fingerprintOf(nonce: Uint8Array, files: readonly OriginalFile[], many: boolean): Promise<string> {
  if (!many) return toHex(await commit(nonce, files[0].bytes));
  return toHex(await commit(nonce, await manifest(files.map((f) => ({ path: f.path, content: f.bytes })))));
}

export async function openOriginal(d: OpenDeps, access: RepoAccess, v: VersionRef, bundle: GithubBundle): Promise<Opened> {
  if (bundle.commitment !== v.commitment) return { kind: "mismatch" };
  const sealed = await readRepoFile(d.github, access, originalPath(v.recordId), d.signal);
  if (!sealed) return { kind: "no_original" };
  const aad = { userId: d.vault.userId, rootId: v.rootId, recordId: v.recordId, version: "0" };
  let nonce: Uint8Array | null = null;
  try {
    nonce = await open(KIND.nonce, d.vault.akPriv, aad, fromB64u(bundle.nonceSealed));
    const plain = await open(KIND.original, d.vault.akPriv, aad, sealed);
    const files: OriginalFile[] | null = bundle.manifest
      ? (untar(plain)?.map((f) => ({ path: f.path, bytes: f.content })) ?? null)
      : [{ path: v.mainFile ?? SINGLE_FALLBACK_NAME, bytes: plain }];
    if (!files || files.length === 0) return { kind: "unreadable" };
    return { kind: "opened", same: (await fingerprintOf(nonce, files, bundle.manifest)) === v.commitment, files, nonce: nonce.slice(), manifest: bundle.manifest };
  } catch {
    return { kind: "unreadable" };
  } finally {
    nonce?.fill(0);
  }
}

/** A text original that can be compared line by line (D2): exactly one file, valid UTF-8, fingerprint intact. */
export function textOf(o: Opened): string | null {
  if (o.kind !== "opened" || !o.same || o.files.length !== 1) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(o.files[0].bytes);
  } catch {
    return null;
  }
}
