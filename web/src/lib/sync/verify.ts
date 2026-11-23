// Spec §8: every record and fragment must carry a valid signature of an engine in the browser-unlocked engine list
// (never the server's engines table). Per engine, the verified log_seqs (records ∪ fragments) must run 1..max with
// no hole; the highest one must not drop below what this browser saw. Gaps and marks are judged on a finished pull only.
import { fromB64u, utf8 } from "@ideatrail/crypto/bytes";
import { messageFor, sha256Hex, verify } from "@ideatrail/crypto/sign";
import type { EngineEntry, EngineList, VersionStore } from "../engine-list";
import type { ChainIssue } from "./chain";
import { rememberMax, seenMax, seqMark } from "./marks";
import type { DeltaRow, RecordRow } from "./rows";
import type { SyncState } from "./store";

export interface Verified { records: readonly RecordRow[]; deltas: readonly DeltaRow[]; issues: readonly ChainIssue[] }

const MISSING_SHOWN = 5;
const parentsOf = (p: string) => (p === "-" ? [] : p.split(","));
const DIGITS = /^[0-9]{1,20}$/;
const HEX64 = /^[0-9a-f]{64}$/;

type Row = { table: "records"; row: RecordRow } | { table: "deltas"; row: DeltaRow };
const idOf = (x: Row) => (x.table === "records" ? x.row.record_id : x.row.delta_id);
const cmpBig = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

const recordMessage = (userId: string, r: RecordRow) => messageFor({
  type: "record_hashed", userId, rootId: r.root_id, recordId: r.record_id, parents: parentsOf(r.parent_ids), commitmentHex: r.commitment,
  metaSealed: fromB64u(r.list_meta), bodyHashHex: r.body_hash, nonceHashHex: r.nonce_hash, logSeq: BigInt(r.log_seq), recordedAt: r.recorded_at,
});
const deltaMessage = (userId: string, d: DeltaRow) => messageFor({
  type: "delta", userId, rootId: d.root_id, deltaId: d.delta_id, deltaSealed: fromB64u(d.sealed_delta), logSeq: BigInt(d.log_seq), createdAt: d.created_at,
});
const messageOf = (userId: string, x: Row) => (x.table === "records" ? recordMessage(userId, x.row) : deltaMessage(userId, x.row));

function signedBy(userId: string, e: EngineEntry, x: Row): boolean {
  try {
    return verify(fromB64u(e.sign_pubkey), messageOf(userId, x), x.row.engine_sig);
  } catch {
    return false; // bad_field or bad base64: same as a wrong signature
  }
}

/**
 * The commitment frozen in the engine list when an engine is disconnected (spec §15 M5a; written by 5.9): hex SHA-256 over
 * the lines "<r|d>\t<log_seq>\t<row id>\t<hex SHA-256 of the row's §8 signed message>" for every accepted row of that engine
 * at or below revoked_after_seq, sorted by (log_seq, kind, id), joined by "\n".
 */
export function revokedDigest(userId: string, rows: { records: readonly RecordRow[]; deltas: readonly DeltaRow[] }): string {
  const all: Row[] = [...rows.records.map((row): Row => ({ table: "records", row })), ...rows.deltas.map((row): Row => ({ table: "deltas", row }))];
  const lines = all
    .map((x) => ({ seq: BigInt(x.row.log_seq), kind: x.table === "records" ? "r" : "d", id: idOf(x), hash: sha256Hex(messageOf(userId, x)) }))
    .sort((a, b) => cmpBig(a.seq, b.seq) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((l) => `${l.kind}\t${l.seq}\t${l.id}\t${l.hash}`);
  return sha256Hex(utf8(lines.join("\n")));
}

const isRevoked = (e: EngineEntry) => e.revoked_at !== undefined || e.revoked_after_seq !== undefined || e.revoked_digest !== undefined;

/** A revoked engine's rows count only if its rows up to the frozen cutoff are exactly the frozen set — never by signed time. */
function revokedKeep(userId: string, e: EngineEntry, rows: readonly Row[], issues: ChainIssue[]): Row[] {
  const cut = e.revoked_after_seq;
  const frozen = typeof cut === "string" && DIGITS.test(cut) && typeof e.revoked_digest === "string" && HEX64.test(e.revoked_digest);
  const under = frozen ? rows.filter((x) => BigInt(x.row.log_seq) <= BigInt(cut)) : [];
  for (const x of rows) if (!under.includes(x)) issues.push({ kind: "unknown_engine", table: x.table, id: idOf(x) });
  if (under.length === 0) return [];
  const split = { records: under.flatMap((x) => (x.table === "records" ? [x.row] : [])), deltas: under.flatMap((x) => (x.table === "deltas" ? [x.row] : [])) };
  if (revokedDigest(userId, split) === e.revoked_digest) return under;
  issues.push({ kind: "revoked_mismatch", engineId: e.engine_id });
  return [];
}

/** Two signed rows claiming one (engine, log_seq): neither is trusted. */
function dropDuplicates(engineId: string, rows: readonly Row[], issues: ChainIssue[]): Row[] {
  const bySeq = new Map<string, number>();
  for (const x of rows) bySeq.set(x.row.log_seq, (bySeq.get(x.row.log_seq) ?? 0) + 1);
  for (const [seq, n] of bySeq) if (n > 1) issues.push({ kind: "duplicate_seq", engineId, seq });
  return rows.filter((x) => bySeq.get(x.row.log_seq) === 1);
}

function gapIssues(engineId: string, seqs: readonly bigint[]): ChainIssue[] {
  const sorted = [...seqs].sort(cmpBig);
  const missing: string[] = [];
  let want = 1n;
  for (const s of sorted) {
    for (let m = want; m < s && missing.length < MISSING_SHOWN; m++) missing.push(m.toString());
    want = s + 1n;
  }
  return missing.length ? [{ kind: "gap", engineId, missing }] : [];
}

export function verifyRows(userId: string, list: EngineList, sync: SyncState, marks: VersionStore): Verified {
  const engines = new Map(list.engines.map((e) => [e.engine_id, e]));
  const issues: ChainIssue[] = sync.bad.map((table) => ({ kind: "bad_row", table }));
  const signed = new Map<string, Row[]>(); // local builder: per engine, rows with a valid signature
  const all: Row[] = [...[...sync.records.values()].map((row): Row => ({ table: "records", row })), ...[...sync.deltas.values()].map((row): Row => ({ table: "deltas", row }))];
  for (const x of all) {
    const e = engines.get(x.row.engine_id);
    if (!e) issues.push({ kind: "unknown_engine", table: x.table, id: idOf(x) });
    else if (!signedBy(userId, e, x)) issues.push({ kind: "bad_signature", table: x.table, id: idOf(x) });
    else signed.set(e.engine_id, [...(signed.get(e.engine_id) ?? []), x]);
  }

  const kept = new Set<Row>();
  const seqs = new Map<string, bigint[]>();
  for (const [engineId, rows] of signed) {
    const e = engines.get(engineId)!;
    const mine = dropDuplicates(engineId, isRevoked(e) ? revokedKeep(userId, e, rows, issues) : rows, issues);
    for (const x of mine) kept.add(x);
    seqs.set(engineId, mine.map((x) => BigInt(x.row.log_seq)));
  }

  if (sync.complete) {
    for (const e of list.engines) {
      const mine = seqs.get(e.engine_id) ?? [];
      issues.push(...gapIssues(e.engine_id, mine));
      const top = mine.reduce((m, s) => (s > m ? s : m), 0n);
      const key = seqMark(userId, e.engine_id);
      if (top < seenMax(marks, key)) issues.push({ kind: "rollback", what: "log_seq", id: e.engine_id });
      else rememberMax(marks, key, top);
    }
  }
  const records = all.flatMap((x) => (x.table === "records" && kept.has(x) ? [x.row] : []));
  const deltas = all.flatMap((x) => (x.table === "deltas" && kept.has(x) ? [x.row] : []));
  return { records, deltas, issues };
}
