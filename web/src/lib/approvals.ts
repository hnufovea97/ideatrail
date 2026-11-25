// The waiting requests of the unlocked dashboard (5.9a). The server is not trusted: a request counts only if a LIVE
// engine of the browser-unlocked list signed it (spec §8 approval signature) and its summary opens for this account.
import { fromB64u } from "@ideatrail/crypto/bytes";
import { KIND, open } from "@ideatrail/crypto/seal";
import type { ApprovalRow } from "./api";
import type { EngineList, VersionStore } from "./engine-list";
import { isLive } from "./engines";
import { signedByEngine, toFolder } from "./folders";
import type { Vault } from "./signup/account";
import { apprMark, rememberMax } from "./sync/marks";

export type ApprovalKind = "import" | "add_folder" | "forget_original" | "disconnect" | "update";
const KINDS: readonly string[] = ["import", "add_folder", "forget_original", "disconnect", "update"];
const MAX_FOLDERS = 50;

export interface ApprovalFolder { path: string; name: string; files: number }
export interface UpdateInfo { from: string; to: string; changes: readonly string[] }
export interface OpenApproval {
  approvalId: string; engineId: string; engineName: string; kind: ApprovalKind; folders: readonly ApprovalFolder[]; expiresAt: string;
  update?: UpdateInfo;
}
interface Summary { folders: ApprovalFolder[]; update?: UpdateInfo }

const isKind = (k: string): k is ApprovalKind => KINDS.includes(k);

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_CHANGES = 20;
const MAX_CHANGE_CHARS = 200;

/** Strict: any violation throws, so the whole row is dropped. */
function toUpdate(raw: unknown): UpdateInfo {
  const u = raw as { from?: unknown; to?: unknown; changes?: unknown } | null;
  if (!u || typeof u !== "object" || typeof u.from !== "string" || typeof u.to !== "string" || !VERSION.test(u.from) || !VERSION.test(u.to)) throw new Error("summary_invalid");
  if (!Array.isArray(u.changes) || u.changes.length > MAX_CHANGES) throw new Error("summary_invalid");
  const changes = u.changes.map((c: unknown) => {
    if (typeof c !== "string" || c.length < 1 || c.length > MAX_CHANGE_CHARS || CONTROL.test(c)) throw new Error("summary_invalid");
    return c;
  });
  return { from: u.from, to: u.to, changes };
}

/** Kind 10 summary, AAD {user_id, root_id = approval_id, version "0"} (spec §15). */
async function openSummary(v: Vault, row: ApprovalRow): Promise<Summary> {
  const pt = await open(KIND.approval_summary, v.akPriv, { userId: v.userId, rootId: row.approval_id, version: "0" }, fromB64u(row.summary));
  const raw = JSON.parse(new TextDecoder().decode(pt)) as { v?: unknown; folders?: unknown; update?: unknown };
  if (raw.v !== 1) throw new Error("summary_invalid");
  if (row.kind === "update") return { folders: [], update: toUpdate(raw.update) };
  if (!Array.isArray(raw.folders)) throw new Error("summary_invalid");
  return { folders: raw.folders.slice(0, MAX_FOLDERS).flatMap(toFolder).map(({ path, name, files }) => ({ path, name, files })) };
}

const DIGITS = /^[0-9]{1,20}$/;

/**
 * Rows that fail any check are left out, never half-shown. Oldest first, as the server sends them.
 * `marks` keeps the highest appr_seq this browser has seen per engine (spec §8; only ever raised, only from rows a live engine
 * signed). Holes are normal here: an answered or expired request leaves the list, so no row is ever dropped for its number.
 */
export async function openApprovals(rows: readonly ApprovalRow[], list: EngineList, v: Vault, marks?: VersionStore): Promise<OpenApproval[]> {
  const out: OpenApproval[] = [];
  for (const r of rows) {
    const engine = list.engines.find((e) => e.engine_id === r.engine_id);
    if (!engine || !isLive(engine) || !isKind(r.kind)) continue; // signup_select belongs to the signup screen
    if (!signedByEngine(r, fromB64u(engine.sign_pubkey), v.userId)) continue;
    if (marks && DIGITS.test(r.appr_seq)) rememberMax(marks, apprMark(v.userId, engine.engine_id), BigInt(r.appr_seq));
    try {
      const { folders, update } = await openSummary(v, r);
      out.push({ approvalId: r.approval_id, engineId: engine.engine_id, engineName: engine.name, kind: r.kind, folders, expiresAt: r.expires_at, ...(update ? { update } : {}) });
    } catch {
      // unreadable or not for this account: dropped
    }
  }
  return out;
}
