// The GitHub access for the mirror: the newest storage link signed by an engine in the unlocked list (spec §8
// storage_link), opened from kind 6 with the account key (AAD {user_id, version "0"}, spec §15 M3b).
import { fromB64u } from "@ideatrail/crypto/bytes";
import { KIND, open } from "@ideatrail/crypto/seal";
import type { EngineList } from "../engine-list";
import { storageLinkValid } from "../github-link";
import type { LinkRow } from "../sync/rows";
import type { RepoAccess } from "./github";

export async function openRepoAccess(v: { userId: string; akPriv: Uint8Array }, list: EngineList, links: Iterable<LinkRow>): Promise<RepoAccess | null> {
  const engines = new Map(list.engines.filter((e) => e.revoked_at === undefined && e.revoked_after_seq === undefined).map((e) => [e.engine_id, e]));
  const valid = [...links]
    .filter((l) => {
      const e = engines.get(l.engine_id);
      return !!e && storageLinkValid(l, e, v.userId);
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  for (const l of valid) {
    try {
      const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
        await open(KIND.storage_token, v.akPriv, { userId: v.userId, version: "0" }, fromB64u(l.enc_token ?? "")))) as Record<string, unknown>;
      if (typeof raw.token === "string" && raw.token.length > 0 && typeof raw.repo_full_name === "string" && Number.isSafeInteger(raw.repo_id)) {
        return { token: raw.token, fullName: raw.repo_full_name, repoId: raw.repo_id as number };
      }
    } catch {
      // does not open: try the next engine's link
    }
  }
  return null;
}
