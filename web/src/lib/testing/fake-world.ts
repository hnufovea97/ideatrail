// vitest only — never import from app code. A user with a master key, an account key and an engine with real
// keys, producing rows exactly as the engine (engine/internal/record) and the API (api/src/routes/sync.ts) do.
import { toB64u, toHex, utf8 } from "@ideatrail/crypto/bytes";
import { newId } from "@ideatrail/crypto/ids";
import { newKemKeyPair, randomKey, signPublicKey, type KemKeyPair } from "@ideatrail/crypto/keypair";
import { KIND, seal } from "@ideatrail/crypto/seal";
import { messageFor, sign } from "@ideatrail/crypto/sign";
import type { EngineEntry, EngineList } from "../engine-list";
import type { AnchorRow, DeltaRow, LinkRow, RecordRow, RootRow } from "../sync/rows";
import { applyPage, emptySync, type SyncState } from "../sync/store";

export interface WorldEngine { id: string; seed: Uint8Array; entry: EngineEntry }
export interface World {
  userId: string; mk: Uint8Array; ak: KemKeyPair; engine: WorldEngine; list: EngineList;
  vault: { userId: string; mk: Uint8Array; akPriv: Uint8Array; akPub: Uint8Array; engineList: EngineList; autoLockMinutes: number };
}

let changeSeq = 0;
const nextChange = () => ++changeSeq;
const randomHex = () => toHex(randomKey());

export function worldEngine(name = "Mac"): WorldEngine {
  const seed = randomKey();
  const id = newId();
  return { id, seed, entry: { engine_id: id, sign_pubkey: toB64u(signPublicKey(seed)), kem_pubkey: toB64u(newKemKeyPair().pub), name, added_at: "2026-11-01T00:00:00Z" } };
}

export function fakeWorld(): World {
  const userId = newId();
  const mk = randomKey();
  const ak = newKemKeyPair();
  const engine = worldEngine();
  const list: EngineList = { v: 1, version: 1, engines: [engine.entry] };
  return { userId, mk, ak, engine, list, vault: { userId, mk, akPriv: ak.priv, akPub: ak.pub, engineList: list, autoLockMinutes: 5 } };
}

/** kind 1 plaintext as engine/internal/record/pipeline.go metaJSON writes it (with M5a tags/routine). */
export const META = (over: Record<string, unknown> = {}) => ({
  v: 1, title: "가계부 앱", milestone: "none", milestone_certain: false, files: [{ path: "docs/plan.md", size: 10, original: true }],
  more_files: 0, recorded_at: "2026-11-10T00:00:00Z", tags: ["기획"], routine: [], ...over,
});

export async function recordRow(w: World, o: { rootId: string; seq: number | string; recordedAt?: string; meta?: Record<string, unknown>; engine?: WorldEngine; parents?: string[]; recipient?: Uint8Array }): Promise<RecordRow> {
  const e = o.engine ?? w.engine;
  const recordId = newId();
  const recordedAt = o.recordedAt ?? "2026-11-10T00:00:00Z";
  const sealed = await seal(KIND.record_meta, o.recipient ?? w.ak.pub, { userId: w.userId, rootId: o.rootId, recordId, version: "0" },
    utf8(JSON.stringify(o.meta ?? META({ recorded_at: recordedAt }))));
  const body_hash = randomHex(), nonce_hash = randomHex(), commitment = randomHex();
  const parents = [...(o.parents ?? [])].sort();
  const engine_sig = sign(e.seed, messageFor({ type: "record_hashed", userId: w.userId, rootId: o.rootId, recordId, parents, commitmentHex: commitment,
    metaSealed: sealed, bodyHashHex: body_hash, nonceHashHex: nonce_hash, logSeq: BigInt(o.seq), recordedAt }));
  return { record_id: recordId, root_id: o.rootId, parent_ids: parents.length ? parents.join(",") : "-", commitment, recorded_at: recordedAt, engine_id: e.id,
    log_seq: String(o.seq), engine_sig, list_meta: toB64u(sealed), body_hash, nonce_hash, deleted_at: null, change_seq: nextChange() };
}

export async function deltaRow(w: World, o: { rootId: string; seq: number | string; createdAt?: string; body: Record<string, unknown>; engine?: WorldEngine; signer?: Uint8Array }): Promise<DeltaRow> {
  const e = o.engine ?? w.engine;
  const deltaId = newId();
  const createdAt = o.createdAt ?? "2026-11-11T00:00:00Z";
  const sealed = await seal(KIND.delta, w.ak.pub, { userId: w.userId, rootId: o.rootId, recordId: deltaId, version: "0" }, utf8(JSON.stringify({ v: 1, ...o.body })));
  const engine_sig = sign(o.signer ?? e.seed, messageFor({ type: "delta", userId: w.userId, rootId: o.rootId, deltaId, deltaSealed: sealed, logSeq: BigInt(o.seq), createdAt }));
  return { delta_id: deltaId, root_id: o.rootId, engine_id: e.id, log_seq: String(o.seq), sealed_delta: toB64u(sealed), engine_sig, created_at: createdAt, merged_at: null, change_seq: nextChange() };
}

/** A storage link as api/src/routes/anchors.ts stores it (created_at = the signed unix_ts). */
export async function linkRow(w: World, repo = { token: "fake-token-for-tests", repo_full_name: "me/ideatrail-proofs", repo_id: 42 }, createdAt = "2026-11-02T00:00:00Z"): Promise<LinkRow> {
  const sealed = await seal(KIND.storage_token, w.ak.pub, { userId: w.userId, version: "0" }, utf8(JSON.stringify(repo)));
  const unixTs = BigInt(Math.floor(Date.parse(createdAt) / 1000));
  const engine_sig = sign(w.engine.seed, messageFor({ type: "storage_link", userId: w.userId, engineId: w.engine.id, tokenSealed: sealed, unixTs }));
  return { link_id: newId(), engine_id: w.engine.id, provider: "github", enc_token: toB64u(sealed), engine_sig, created_at: createdAt, revoked_at: null, change_seq: nextChange() };
}

export const rootRow = (rootId: string, over: Partial<RootRow> = {}): RootRow =>
  ({ root_id: rootId, visibility: "private", meta_version: 0, list_meta: null, created_at: "2026-11-10T00:00:00Z", deleted_at: null, change_seq: nextChange(), ...over });
export const anchorRow = (recordId: string, over: Partial<AnchorRow> = {}): AnchorRow =>
  ({ record_id: recordId, status: "pending", block_height: null, change_seq: nextChange(), ...over });

export function syncOf(rows: { roots?: RootRow[]; records?: RecordRow[]; deltas?: DeltaRow[]; anchors?: AnchorRow[]; links?: LinkRow[] }, complete = true): SyncState {
  const page = { roots: rows.roots ?? [], records: rows.records ?? [], deltas: rows.deltas ?? [], anchors: rows.anchors ?? [], storage_links: rows.links ?? [], bad: [] };
  return applyPage(emptySync(), page, changeSeq, complete);
}
