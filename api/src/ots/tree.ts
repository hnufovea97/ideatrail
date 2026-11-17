// Minimal OpenTimestamps timestamp-tree reader/writer (server side).
// Only what calendars actually emit is accepted: sha256 / append / prepend operations and
// pending / bitcoin attestations. Anything else is rejected, as are oversized or deep trees.
import { sha256 } from "@noble/hashes/sha2.js";
import { concat } from "@ideatrail/crypto/bytes";

export const MAX_RECEIPT_BYTES = 8 * 1024;
const MAX_DEPTH = 256; // real calendar+bitcoin paths exceed 64 ops; size cap bounds the rest
const MAX_ARG = 4096;
const MAX_NODES = 256;
const MAX_ATTESTATIONS_PER_NODE = 8;
const MAX_MSG = 1024; // calendar messages are ~32–100 bytes; caps append/prepend growth
const MAX_HASHED_BYTES = 32 * 1024; // total sha256 input per parse — bounds CPU (free plan: 10ms)
const MAX_URI = 1000;

const OP_SHA256 = 0x08;
const OP_APPEND = 0xf0;
const OP_PREPEND = 0xf1;
const BRANCH = 0xff;
const ATTESTATION = 0x00;
const TAG_PENDING = Uint8Array.from([0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e]);
const TAG_BITCOIN = Uint8Array.from([0x05, 0x88, 0x96, 0x0d, 0x73, 0xd7, 0x19, 0x01]);

export type Op = { kind: "sha256" } | { kind: "append" | "prepend"; arg: Uint8Array };
export type Attestation = { kind: "pending"; uri: string } | { kind: "bitcoin"; height: number };
export interface Timestamp {
  msg: Uint8Array;
  attestations: Attestation[];
  ops: { op: Op; next: Timestamp }[];
}

export class OtsError extends Error {}
const bad = (why: string) => new OtsError(`ots: ${why}`);

class Reader {
  i = 0;
  nodes = 0;
  hashed = 0;
  constructor(readonly b: Uint8Array) {}
  byte(): number {
    if (this.i >= this.b.length) throw bad("truncated");
    return this.b[this.i++];
  }
  bytes(n: number): Uint8Array {
    if (this.i + n > this.b.length) throw bad("truncated");
    const out = this.b.subarray(this.i, this.i + n);
    this.i += n;
    return out;
  }
  varuint(): number {
    let v = 0;
    for (let shift = 0; shift < 49; shift += 7) { // at most 7 bytes
      const x = this.byte();
      v += (x & 0x7f) * 2 ** shift;
      if (!(x & 0x80)) return v;
    }
    throw bad("varuint too long");
  }
  varbytes(max: number): Uint8Array {
    const n = this.varuint();
    if (n > max) throw bad("field too long");
    return this.bytes(n);
  }
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

export function applyOp(op: Op, msg: Uint8Array): Uint8Array {
  if (op.kind === "sha256") return sha256(msg);
  return op.kind === "append" ? concat(msg, op.arg) : concat(op.arg, msg);
}

function readAttestation(r: Reader): Attestation {
  const tag = r.bytes(8);
  const payload = new Reader(r.varbytes(MAX_URI + 8));
  let att: Attestation;
  if (sameBytes(tag, TAG_PENDING)) {
    const raw = payload.varbytes(MAX_URI);
    let uri: string;
    try {
      uri = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(raw);
    } catch {
      throw bad("bad uri");
    }
    att = { kind: "pending", uri };
  } else if (sameBytes(tag, TAG_BITCOIN)) {
    att = { kind: "bitcoin", height: payload.varuint() };
  } else {
    throw bad("unsupported attestation");
  }
  if (payload.i !== payload.b.length) throw bad("trailing attestation bytes");
  return att;
}

function readOp(r: Reader, tag: number): Op {
  if (tag === OP_SHA256) return { kind: "sha256" };
  if (tag === OP_APPEND) return { kind: "append", arg: r.varbytes(MAX_ARG) };
  if (tag === OP_PREPEND) return { kind: "prepend", arg: r.varbytes(MAX_ARG) };
  throw bad(`unsupported op 0x${tag.toString(16)}`);
}

function readNode(r: Reader, msg: Uint8Array, depth: number): Timestamp {
  if (depth > MAX_DEPTH) throw bad("too deep");
  if (++r.nodes > MAX_NODES) throw bad("too many nodes");
  if (msg.length > MAX_MSG) throw bad("message too long");
  const node: Timestamp = { msg, attestations: [], ops: [] };
  const one = (tag: number) => {
    if (tag === ATTESTATION) {
      if (node.attestations.length >= MAX_ATTESTATIONS_PER_NODE) throw bad("too many attestations");
      node.attestations.push(readAttestation(r));
      return;
    }
    const op = readOp(r, tag);
    if (op.kind === "sha256" && (r.hashed += msg.length) > MAX_HASHED_BYTES) throw bad("too much hashing");
    const next = applyOp(op, msg);
    node.ops.push({ op, next: readNode(r, next, depth + 1) });
  };
  let tag = r.byte();
  while (tag === BRANCH) {
    one(r.byte());
    tag = r.byte();
  }
  one(tag);
  return node;
}

/** Parse a raw timestamp tree (calendar response format) for `msg`. */
export function parseTimestamp(bytes: Uint8Array, msg: Uint8Array): Timestamp {
  if (bytes.length > MAX_RECEIPT_BYTES) throw bad("receipt too large");
  const r = new Reader(bytes);
  const t = readNode(r, msg, 0);
  if (r.i !== bytes.length) throw bad("trailing bytes");
  return t;
}

const HEADER = Uint8Array.from([0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00, 0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94]);

/** Parse a detached .ots file whose file-hash op is sha256 (used for test vectors). */
export function parseOtsFile(bytes: Uint8Array): { digest: Uint8Array; timestamp: Timestamp } {
  if (!sameBytes(bytes.subarray(0, HEADER.length), HEADER)) throw bad("not an .ots file");
  const r = new Reader(bytes.subarray(HEADER.length));
  if (r.varuint() !== 1) throw bad("unsupported version");
  if (r.byte() !== OP_SHA256) throw bad("unsupported file hash");
  const digest = r.bytes(32);
  return { digest, timestamp: parseTimestamp(bytes.subarray(HEADER.length + r.i), digest) };
}

function varuint(n: number): Uint8Array {
  const out: number[] = [];
  do {
    let x = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) x |= 0x80;
    out.push(x);
  } while (n > 0);
  return Uint8Array.from(out);
}
const varbytes = (b: Uint8Array) => concat(varuint(b.length), b);

function writeAttestation(a: Attestation): Uint8Array {
  const payload = a.kind === "pending" ? varbytes(new TextEncoder().encode(a.uri)) : varuint(a.height);
  return concat(Uint8Array.of(ATTESTATION), a.kind === "pending" ? TAG_PENDING : TAG_BITCOIN, varbytes(payload));
}
function writeOp(op: Op): Uint8Array {
  if (op.kind === "sha256") return Uint8Array.of(OP_SHA256);
  return concat(Uint8Array.of(op.kind === "append" ? OP_APPEND : OP_PREPEND), varbytes(op.arg));
}

/** Serialize in the reference order: attestations first, then ops; all but the last item behind 0xff. */
export function serializeTimestamp(t: Timestamp): Uint8Array {
  const parts: Uint8Array[] = []; // collected once and joined once (no per-level copying)
  const write = (n: Timestamp) => {
    const count = n.attestations.length + n.ops.length;
    if (count === 0) throw bad("empty node");
    let i = 0;
    const sep = () => { if (i++ < count - 1) parts.push(Uint8Array.of(BRANCH)); };
    for (const a of n.attestations) { sep(); parts.push(writeAttestation(a)); }
    for (const { op, next } of n.ops) { sep(); parts.push(writeOp(op)); write(next); }
  };
  write(t);
  return concat(...parts);
}

export interface PendingPoint { uri: string; node: Timestamp }

/** Every node carrying a pending attestation (where a calendar can be asked for an upgrade). */
export function pendingPoints(t: Timestamp): PendingPoint[] {
  const out: PendingPoint[] = [];
  const walk = (n: Timestamp) => {
    for (const a of n.attestations) if (a.kind === "pending") out.push({ uri: a.uri, node: n });
    for (const { next } of n.ops) walk(next);
  };
  walk(t);
  return out;
}

/** Lowest bitcoin height in the tree — an UNVERIFIED hint; the browser checks it against block headers (spec §8). */
export function bitcoinHeight(t: Timestamp): number | null {
  let best: number | null = null;
  const walk = (n: Timestamp) => {
    for (const a of n.attestations) if (a.kind === "bitcoin" && (best === null || a.height < best)) best = a.height;
    for (const { next } of n.ops) walk(next);
  };
  walk(t);
  return best;
}

/** Merge a calendar's upgrade (a tree for `node.msg`) into `node` (mutates `node`). */
export function mergeInto(node: Timestamp, upgrade: Timestamp): void {
  if (!sameBytes(node.msg, upgrade.msg)) throw bad("upgrade is for another message");
  node.ops.push(...upgrade.ops);
  for (const a of upgrade.attestations) if (a.kind === "bitcoin") node.attestations.push(a);
}
