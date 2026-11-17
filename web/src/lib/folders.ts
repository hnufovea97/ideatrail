import { fromB64u } from "@ideatrail/crypto/bytes";
import { KIND, open } from "@ideatrail/crypto/seal";
import { messageFor, verify } from "@ideatrail/crypto/sign";
import type { ApprovalRow, SealedMessage } from "./api";
import type { EngineEntry } from "./engine-list";
import { sealInbox } from "./inbox";
import type { Vault } from "./signup/account";
import { cleanLabel } from "./text";

export const IMPORT_LIMIT = 200; // files per signup import (decision D1)
const MAX_FOLDERS = 20;
const MAX_NAME = 60;
const MAX_PATH = 4096;
const MAX_FILES = 1_000_000;

export interface SuggestedFolder { path: string; name: string; files: number; current: boolean }

function signedByEngine(r: ApprovalRow, pub: Uint8Array, userId: string): boolean {
  try {
    return verify(pub, messageFor({ type: "approval", userId, approvalId: r.approval_id, kind: r.kind, summarySealed: fromB64u(r.summary), apprSeq: BigInt(r.appr_seq) }), r.engine_sig);
  } catch {
    return false;
  }
}

/** The newest signup_select from THIS engine with a valid engine signature (spec §8 browser rule). */
export function signupApproval(rows: ApprovalRow[], engine: EngineEntry, userId: string): ApprovalRow | null {
  const pub = fromB64u(engine.sign_pubkey);
  const valid = rows.filter((r) => r.kind === "signup_select" && r.engine_id === engine.engine_id && signedByEngine(r, pub, userId));
  return valid.at(-1) ?? null;
}

function toFolder(x: unknown): SuggestedFolder[] {
  const f = x as Record<string, unknown> | null;
  if (!f || typeof f.path !== "string" || f.path.length === 0 || f.path.length > MAX_PATH || typeof f.name !== "string") return [];
  if (!Number.isInteger(f.files) || (f.files as number) < 0 || (f.files as number) > MAX_FILES) return [];
  const name = cleanLabel(f.name, MAX_NAME);
  return name ? [{ path: f.path, name, files: f.files as number, current: f.current === true }] : [];
}

/** Kind 11 summary, AAD {user_id, root_id = approval_id, version "0"} (spec §15). */
export async function openSuggestions(v: Vault, row: ApprovalRow): Promise<SuggestedFolder[]> {
  const pt = await open(KIND.folder_suggestions, v.akPriv, { userId: v.userId, rootId: row.approval_id, version: "0" }, fromB64u(row.summary));
  const raw = JSON.parse(new TextDecoder().decode(pt)) as { v?: unknown; folders?: unknown };
  if (raw.v !== 1 || !Array.isArray(raw.folders)) throw new Error("summary_invalid");
  const list = raw.folders.slice(0, MAX_FOLDERS).flatMap(toFolder);
  const hasCurrent = list.some((f) => f.current);
  return list.map((f, i) => ({ ...f, current: hasCurrent ? f.current : i === 0 })); // G3: older engines mark nothing
}

export const initialSelection = (fs: SuggestedFolder[]): ReadonlySet<string> => new Set(fs.filter((f) => f.current).map((f) => f.path));

export function planImport(fs: SuggestedFolder[], selected: ReadonlySet<string>): { files: number; later: number } {
  const files = fs.filter((f) => selected.has(f.path)).reduce((n, f) => n + f.files, 0);
  return { files, later: Math.max(0, files - IMPORT_LIMIT) };
}

/** The decide body: paths exactly as the engine sent them (the engine intersects with its own list). */
export async function buildDecision(v: Vault, engineKemPub: Uint8Array, approvalId: string, paths: string[]): Promise<{ decision: "approved" | "rejected"; message: SealedMessage }> {
  const message = await sealInbox(v, engineKemPub, { type: "select_folders", approval_id: approvalId, folders: paths });
  return { decision: paths.length > 0 ? "approved" : "rejected", message };
}
