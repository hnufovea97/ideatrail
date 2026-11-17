import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { fromB64u, toB64u, toHex, utf8 } from "./bytes";
import { idField, joinFields, orDash, SEP_SIGN } from "./format";

/** The six signed message types (spec §8). Numbers are bigint: sequences are uint64. */
export type Signable =
  | { type: "request"; method: string; path: string; body: Uint8Array; engineId: string; reqSeq: bigint; unixTs: bigint }
  | { type: "record"; userId: string; rootId: string; recordId: string; parents: string[]; commitmentHex: string; metaSealed: Uint8Array; bodySealed: Uint8Array; nonceSealed: Uint8Array; logSeq: bigint; recordedAt: string }
  | { type: "delta"; userId: string; rootId: string; deltaId: string; deltaSealed: Uint8Array; logSeq: bigint; createdAt: string }
  | { type: "storage_link"; userId: string; engineId: string; tokenSealed: Uint8Array; unixTs: bigint }
  | { type: "repo_head"; userId: string; engineId: string; commitSha: string; unixTs: bigint }
  | { type: "approval"; userId: string; approvalId: string; kind: string; summarySealed: Uint8Array; apprSeq: bigint };

const SEED_LEN = 32;
const PUB_LEN = 32;
const SIG_LEN = 64;

const h = (b: Uint8Array) => toHex(sha256(b));
const U64_MAX = 2n ** 64n - 1n;
const I64_MIN = -(2n ** 63n);
const I64_MAX = 2n ** 63n - 1n;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function u64(n: bigint): string {
  if (n < 0n || n > U64_MAX) throw new Error("bad_field");
  return n.toString();
}
function i64(n: bigint): string {
  if (n < I64_MIN || n > I64_MAX) throw new Error("bad_field");
  return n.toString();
}
function match(re: RegExp, s: string): string {
  if (!re.test(s)) throw new Error("bad_field");
  return s;
}

function parents(ps: string[]): string {
  if (ps.length === 0) return "-";
  for (const p of ps) if (!p || p === "-" || idField(p) !== p) throw new Error("bad_field");
  const sorted = [...ps].sort(); // ids are ASCII: code-unit order = Go byte order
  if (new Set(sorted).size !== sorted.length) throw new Error("bad_field"); // duplicate parent
  return sorted.join(",");
}

function fields(s: Signable): string[] {
  switch (s.type) {
    case "request":
      return ["ideatrail-v1-req", s.method, s.path, h(s.body), idField(s.engineId), u64(s.reqSeq), i64(s.unixTs)];
    case "record":
      return ["ideatrail-v1-record", idField(s.userId), idField(s.rootId), idField(s.recordId), parents(s.parents), match(SHA256_HEX, s.commitmentHex),
        h(s.metaSealed), h(s.bodySealed), h(s.nonceSealed), u64(s.logSeq), match(TIME, s.recordedAt)];
    case "delta":
      return ["ideatrail-v1-delta", idField(s.userId), idField(s.rootId), idField(s.deltaId), h(s.deltaSealed), u64(s.logSeq), match(TIME, s.createdAt)];
    case "storage_link":
      return ["ideatrail-v1-storagelink", idField(s.userId), idField(s.engineId), h(s.tokenSealed), i64(s.unixTs)];
    case "repo_head":
      return ["ideatrail-v1-repohead", idField(s.userId), idField(s.engineId), match(COMMIT_SHA, s.commitSha), i64(s.unixTs)];
    case "approval":
      return ["ideatrail-v1-approval", idField(s.userId), idField(s.approvalId), s.kind, h(s.summarySealed), u64(s.apprSeq)];
  }
}

/** Bytes to sign: join(0x0A, fields), empty fields as "-". */
export const messageFor = (s: Signable): Uint8Array => utf8(joinFields(SEP_SIGN, fields(s).map((f) => orDash(f))));

export function sign(seed: Uint8Array, msg: Uint8Array): string {
  if (seed.length !== SEED_LEN) throw new Error("bad_key");
  return toB64u(ed25519.sign(msg, seed));
}

/** Strict RFC 8032 verification (zip215: false) to match Go crypto/ed25519 and WebCrypto. */
export function verify(pub: Uint8Array, msg: Uint8Array, sig: string): boolean {
  if (pub.length !== PUB_LEN) return false;
  try {
    const raw = fromB64u(sig);
    if (raw.length !== SIG_LEN) return false;
    return ed25519.verify(raw, msg, pub, { zip215: false });
  } catch {
    return false;
  }
}
