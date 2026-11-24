// What the version screen can show of a version's original (5.13): no GitHub link, not uploaded yet, found, or failed.
// Reads only proofs/<record_id>/bundle.json here; opening the original is original.ts.
import type { Fetch } from "../api";
import { GithubFailure, readRepoFile } from "../mirror/github";
import { openRepoAccess } from "../mirror/storage";
import type { LinkRow } from "../sync/rows";
import type { DashboardVault } from "../unlock";

/** The two fields of the GitHub bundle.json (spec §12) this screen needs; the rest is for /verify. */
export interface GithubBundle { commitment: string; nonceSealed: string }
export type Source =
  | { kind: "unlinked" }
  | { kind: "not_yet" }
  | { kind: "ready"; bundle: GithubBundle }
  | { kind: "failed" };

export interface SourceDeps { vault: Pick<DashboardVault, "userId" | "akPriv" | "engineList">; links: Iterable<LinkRow>; github: Fetch; signal?: AbortSignal }

const RECORD_ID = /^[0-9a-hjkmnp-tv-z]{26}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const B64U = /^[A-Za-z0-9_-]+$/;

export const bundlePath = (recordId: string) => `proofs/${recordId}/bundle.json`;
export const originalPath = (recordId: string) => `proofs/${recordId}/original.it1`;

export function parseBundle(bytes: Uint8Array): GithubBundle | null {
  try {
    const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as { commitment?: unknown; nonce_sealed?: unknown } | null;
    if (typeof raw?.commitment !== "string" || !HEX64.test(raw.commitment)) return null;
    if (typeof raw.nonce_sealed !== "string" || !B64U.test(raw.nonce_sealed)) return null;
    return { commitment: raw.commitment, nonceSealed: raw.nonce_sealed };
  } catch {
    return null;
  }
}

export async function loadSource(d: SourceDeps, recordId: string): Promise<Source> {
  if (!RECORD_ID.test(recordId)) return { kind: "failed" };
  const access = await openRepoAccess(d.vault, d.vault.engineList, d.links);
  if (!access) return { kind: "unlinked" };
  try {
    const bytes = await readRepoFile(d.github, access, bundlePath(recordId), d.signal);
    if (!bytes) return { kind: "not_yet" };
    const bundle = parseBundle(bytes);
    return bundle ? { kind: "ready", bundle } : { kind: "failed" };
  } catch (e) {
    if (e instanceof GithubFailure) return { kind: "failed" };
    throw e;
  }
}
