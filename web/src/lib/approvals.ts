// The waiting requests of the unlocked dashboard (5.9a). The server is not trusted: a request counts only if a LIVE
// engine of the browser-unlocked list signed it (spec §8 approval signature) and its summary opens for this account.
import { fromB64u } from "@ideatrail/crypto/bytes";
import { KIND, open } from "@ideatrail/crypto/seal";
import type { ApprovalRow } from "./api";
import type { EngineList } from "./engine-list";
import { isLive } from "./engines";
import { signedByEngine, toFolder } from "./folders";
import type { Vault } from "./signup/account";

export type ApprovalKind = "import" | "add_folder" | "forget_original" | "disconnect";
const KINDS: readonly string[] = ["import", "add_folder", "forget_original", "disconnect"];
const MAX_FOLDERS = 50;

export interface ApprovalFolder { path: string; name: string; files: number }
export interface OpenApproval {
  approvalId: string; engineId: string; engineName: string; kind: ApprovalKind; folders: readonly ApprovalFolder[]; expiresAt: string;
}

const isKind = (k: string): k is ApprovalKind => KINDS.includes(k);

/** Kind 10 summary, AAD {user_id, root_id = approval_id, version "0"} (spec §15). */
async function openSummary(v: Vault, row: ApprovalRow): Promise<ApprovalFolder[]> {
  const pt = await open(KIND.approval_summary, v.akPriv, { userId: v.userId, rootId: row.approval_id, version: "0" }, fromB64u(row.summary));
  const raw = JSON.parse(new TextDecoder().decode(pt)) as { v?: unknown; folders?: unknown };
  if (raw.v !== 1 || !Array.isArray(raw.folders)) throw new Error("summary_invalid");
  return raw.folders.slice(0, MAX_FOLDERS).flatMap(toFolder).map(({ path, name, files }) => ({ path, name, files }));
}

/** Rows that fail any check are left out, never half-shown. Oldest first, as the server sends them. */
export async function openApprovals(rows: readonly ApprovalRow[], list: EngineList, v: Vault): Promise<OpenApproval[]> {
  const out: OpenApproval[] = [];
  for (const r of rows) {
    const engine = list.engines.find((e) => e.engine_id === r.engine_id);
    if (!engine || !isLive(engine) || !isKind(r.kind)) continue; // signup_select belongs to the signup screen
    if (!signedByEngine(r, fromB64u(engine.sign_pubkey), v.userId)) continue;
    try {
      out.push({ approvalId: r.approval_id, engineId: engine.engine_id, engineName: engine.name, kind: r.kind, folders: await openSummary(v, r), expiresAt: r.expires_at });
    } catch {
      // unreadable or not for this account: dropped
    }
  }
  return out;
}
