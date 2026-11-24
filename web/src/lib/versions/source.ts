// What the version screen can show of a version's original (5.13, 5.6): no GitHub link, not uploaded yet, found
// (opened, checked against the signed fingerprint, compared with the version before it), or failed.
import type { Fetch } from "../api";
import type { VersionView } from "../model/read-model";
import { GithubFailure, readRepoFile, type RepoAccess } from "../mirror/github";
import { openRepoAccess } from "../mirror/storage";
import type { LinkRow } from "../sync/rows";
import type { DashboardVault } from "../unlock";
import { bundlePath, parseBundle } from "./bundle";
import { lineDiff, type DiffLine } from "./diff";
import { openOriginal, textOf, type Opened, type OpenDeps, type VersionRef } from "./original";

/** `diff`: null when the version has no earlier text to compare with, or when either side is not one intact UTF-8 file (D2). */
export interface Ready { original: Opened; diff: { lines: readonly DiffLine[] | null } | null } // lines null = too long to compare
export type Source =
  | { kind: "unlinked" }
  | { kind: "not_yet" }
  | { kind: "ready"; original: Opened; diff: Ready["diff"] }
  | { kind: "failed" };

export interface SourceDeps { vault: Pick<DashboardVault, "userId" | "akPriv" | "engineList">; links: Iterable<LinkRow>; github: Fetch; signal?: AbortSignal }

const RECORD_ID = /^[0-9a-hjkmnp-tv-z]{26}$/;

export const refOf = (v: VersionView): VersionRef => ({ recordId: v.recordId, rootId: v.rootId, commitment: v.server.commitment, mainFile: v.locked.mainFile });

/** `previous`: the version just before this one, if any (its original is read only for the comparison). */
export async function loadSource(d: SourceDeps, v: VersionRef, previous: VersionRef | null = null): Promise<Source> {
  if (!RECORD_ID.test(v.recordId) || (previous && !RECORD_ID.test(previous.recordId))) return { kind: "failed" };
  const access = await openRepoAccess(d.vault, d.vault.engineList, d.links);
  if (!access) return { kind: "unlinked" };
  const deps: OpenDeps = { vault: d.vault, github: d.github, signal: d.signal };
  try {
    const bytes = await readRepoFile(d.github, access, bundlePath(v.recordId), d.signal);
    if (!bytes) return { kind: "not_yet" };
    const bundle = parseBundle(bytes);
    if (!bundle) return { kind: "failed" };
    const original = await openOriginal(deps, access, v, bundle);
    const now = textOf(original);
    if (now === null || !previous) return { kind: "ready", original, diff: null };
    const before = await previousText(d, deps, access, previous);
    return { kind: "ready", original, diff: before === null ? null : { lines: lineDiff(before, now) } };
  } catch (e) {
    if (e instanceof GithubFailure) return { kind: "failed" };
    throw e;
  }
}

/** The earlier version's text; any trouble just means "no comparison", never a failure of this version. */
async function previousText(d: SourceDeps, deps: OpenDeps, access: RepoAccess, p: VersionRef): Promise<string | null> {
  try {
    const bytes = await readRepoFile(d.github, access, bundlePath(p.recordId), d.signal);
    const bundle = bytes ? parseBundle(bytes) : null;
    return bundle ? textOf(await openOriginal(deps, access, p, bundle)) : null;
  } catch {
    return null;
  }
}
