// Spec §8: every record and fragment must carry a valid signature of an engine in the browser-unlocked engine list
// (never the server's engines table). Per engine, the verified log_seqs (records ∪ fragments) must run 1..max with
// no hole; the highest one must not drop below what this browser saw. Gaps and marks are judged on a finished pull only.
import { fromB64u } from "@ideatrail/crypto/bytes";
import { messageFor, verify } from "@ideatrail/crypto/sign";
import type { EngineEntry, EngineList, VersionStore } from "../engine-list";
import type { ChainIssue } from "./chain";
import { rememberMax, seenMax, seqMark } from "./marks";
import type { DeltaRow, RecordRow } from "./rows";
import type { SyncState } from "./store";

export interface Verified { records: readonly RecordRow[]; deltas: readonly DeltaRow[]; issues: readonly ChainIssue[] }

const MISSING_SHOWN = 5;
const parentsOf = (p: string) => (p === "-" ? [] : p.split(","));
const usable = (e: EngineEntry | undefined, at: string): e is EngineEntry => !!e && (!e.revoked_at || at <= e.revoked_at);

function signedBy(e: EngineEntry, message: () => Uint8Array, sig: string): boolean {
  try {
    return verify(fromB64u(e.sign_pubkey), message(), sig);
  } catch {
    return false; // bad_field or bad base64: same as a wrong signature
  }
}

const recordSigned = (userId: string, e: EngineEntry, r: RecordRow) => signedBy(e, () => messageFor({
  type: "record_hashed", userId, rootId: r.root_id, recordId: r.record_id, parents: parentsOf(r.parent_ids), commitmentHex: r.commitment,
  metaSealed: fromB64u(r.list_meta), bodyHashHex: r.body_hash, nonceHashHex: r.nonce_hash, logSeq: BigInt(r.log_seq), recordedAt: r.recorded_at,
}), r.engine_sig);

const deltaSigned = (userId: string, e: EngineEntry, d: DeltaRow) => signedBy(e, () => messageFor({
  type: "delta", userId, rootId: d.root_id, deltaId: d.delta_id, deltaSealed: fromB64u(d.sealed_delta), logSeq: BigInt(d.log_seq), createdAt: d.created_at,
}), d.engine_sig);

function seqIssues(engineId: string, seqs: readonly bigint[]): ChainIssue[] {
  const sorted = [...seqs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const issues: ChainIssue[] = [];
  const missing: string[] = [];
  let want = 1n;
  for (const s of sorted) {
    if (s < want) {
      issues.push({ kind: "duplicate_seq", engineId, seq: s.toString() });
      continue;
    }
    for (let m = want; m < s && missing.length < MISSING_SHOWN; m++) missing.push(m.toString());
    want = s + 1n;
  }
  return missing.length ? [...issues, { kind: "gap", engineId, missing }] : issues;
}

export function verifyRows(userId: string, list: EngineList, sync: SyncState, marks: VersionStore): Verified {
  const engines = new Map(list.engines.map((e) => [e.engine_id, e]));
  const issues: ChainIssue[] = sync.bad.map((table) => ({ kind: "bad_row", table }));
  const seqs = new Map<string, bigint[]>();
  const counted = (engineId: string, seq: string) => { // local builder: filled here, never shared
    const list = seqs.get(engineId);
    if (list) list.push(BigInt(seq));
    else seqs.set(engineId, [BigInt(seq)]);
  };

  const records = [...sync.records.values()].filter((r) => {
    const e = engines.get(r.engine_id);
    if (!usable(e, r.recorded_at)) return (issues.push({ kind: "unknown_engine", table: "records", id: r.record_id }), false);
    if (!recordSigned(userId, e, r)) return (issues.push({ kind: "bad_signature", table: "records", id: r.record_id }), false);
    counted(r.engine_id, r.log_seq);
    return true;
  });
  const deltas = [...sync.deltas.values()].filter((d) => {
    const e = engines.get(d.engine_id);
    if (!usable(e, d.created_at)) return (issues.push({ kind: "unknown_engine", table: "deltas", id: d.delta_id }), false);
    if (!deltaSigned(userId, e, d)) return (issues.push({ kind: "bad_signature", table: "deltas", id: d.delta_id }), false);
    counted(d.engine_id, d.log_seq);
    return true;
  });

  if (sync.complete) {
    for (const e of list.engines) {
      const mine = seqs.get(e.engine_id) ?? [];
      issues.push(...seqIssues(e.engine_id, mine));
      const top = mine.reduce((m, s) => (s > m ? s : m), 0n);
      const key = seqMark(userId, e.engine_id);
      if (top < seenMax(marks, key)) issues.push({ kind: "rollback", what: "log_seq", id: e.engine_id });
      else rememberMax(marks, key, top);
    }
  }
  return { records, deltas, issues };
}
