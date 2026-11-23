import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import data from "../../../spec/vectors/sign.json";
import { messageFor, sign, verify, type Signable } from "./sign";
import { fromB64u, fromHex, toB64u, toHex } from "./bytes";

const RFC8032_EMPTY_SIG = "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";
const ID = "01jcm3v8q7s2kx4f9d6b5n0tqw", ID2 = "01jcm3v8q7s2kx4f9d6b5n0tqz";

const inputOf = (v: { input: object }) => v.input as Record<string, string>;

function toSignable(name: string, i: Record<string, string>): Signable {
  const b = (k: string) => fromHex(i[k]);
  if (name === "request") return { type: "request", method: i.method, path: i.path, body: b("body_hex"), engineId: i.engine_id, reqSeq: BigInt(i.req_seq), unixTs: BigInt(i.unix_ts) };
  if (name.startsWith("record")) return { type: "record", userId: i.user_id, rootId: i.root_id, recordId: i.record_id, parents: i.parents ? i.parents.split(",") : [], commitmentHex: i.commitment_hex, metaSealed: b("meta_sealed_hex"), bodySealed: b("body_sealed_hex"), nonceSealed: b("nonce_sealed_hex"), logSeq: BigInt(i.log_seq), recordedAt: i.recorded_at };
  if (name === "delta") return { type: "delta", userId: i.user_id, rootId: i.root_id, deltaId: i.delta_id, deltaSealed: b("delta_sealed_hex"), logSeq: BigInt(i.log_seq), createdAt: i.created_at };
  if (name === "storage_link") return { type: "storage_link", userId: i.user_id, engineId: i.engine_id, tokenSealed: b("token_sealed_hex"), unixTs: BigInt(i.unix_ts) };
  if (name === "repo_head") return { type: "repo_head", userId: i.user_id, engineId: i.engine_id, commitSha: i.commit_sha, unixTs: BigInt(i.unix_ts) };
  if (name === "approval") return { type: "approval", userId: i.user_id, approvalId: i.approval_id, kind: i.kind, summarySealed: b("summary_sealed_hex"), apprSeq: BigInt(i.appr_seq) };
  throw new Error("unknown vector " + name);
}

describe("sign §8", () => {
  it("RFC 8032 TEST 1 (empty message)", () => {
    expect(toHex(fromB64u(sign(fromHex(data.seed_hex), new Uint8Array(0))))).toBe(RFC8032_EMPTY_SIG);
  });
  for (const v of data.vectors) {
    it(`${v.name} matches Go`, () => {
      const msg = messageFor(toSignable(v.name, inputOf(v)));
      expect(toHex(msg)).toBe(v.message_hex);
      expect(sign(fromHex(data.seed_hex), msg)).toBe(v.signature_b64u);
      expect(verify(fromHex(data.public_hex), msg, v.signature_b64u)).toBe(true);
    });
  }
  it("seq above 2^53 survives", () => {
    const s = toSignable("request", inputOf(data.vectors[0])) as Extract<Signable, { type: "request" }>;
    expect(s.reqSeq).toBe(9223372036854775813n);
  });
  it("tampered field fails", () => {
    const v = data.vectors[0];
    const s = toSignable(v.name, inputOf(v)) as Extract<Signable, { type: "request" }>;
    expect(verify(fromHex(data.public_hex), messageFor({ ...s, reqSeq: s.reqSeq + 1n }), v.signature_b64u)).toBe(false);
  });
  it("rejects non-canonical S (S + L), short keys and bad base64", () => {
    const L = 2n ** 252n + 27742317777372353535851937790883648493n;
    const msg = new Uint8Array([1]);
    const raw = fromB64u(sign(fromHex(data.seed_hex), msg));
    let s = 0n;
    for (let i = 31; i >= 0; i--) s = (s << 8n) | BigInt(raw[32 + i]);
    s += L;
    const nonCanon = raw.slice();
    for (let i = 0; i < 32; i++) { nonCanon[32 + i] = Number(s & 0xffn); s >>= 8n; }
    const pub = fromHex(data.public_hex);
    expect(verify(pub, msg, toB64u(nonCanon))).toBe(false);
    expect(verify(pub.subarray(0, 31), msg, toB64u(raw))).toBe(false);
    expect(verify(pub, msg, toB64u(raw.subarray(0, 63)))).toBe(false);
    expect(verify(pub, msg, "!!")).toBe(false);
    expect(() => sign(new Uint8Array(31), msg)).toThrow("bad_key");
  });
  it("bad fields", () => {
    expect(() => messageFor({ type: "repo_head", userId: ID, engineId: ID2, commitSha: "a\nb", unixTs: 1n })).toThrow("bad_field");
    expect(() => messageFor({ type: "repo_head", userId: "u", engineId: ID2, commitSha: "c", unixTs: 1n })).toThrow("bad_field");
  });
  it("empty fields become -", () => {
    const m = new TextDecoder().decode(messageFor({ type: "approval", userId: ID, approvalId: ID2, kind: "", summarySealed: new Uint8Array(0), apprSeq: 1n }));
    expect(m).toBe(`ideatrail-v1-approval\n${ID}\n${ID2}\n-\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\n1`);
  });
  it("range and shape checks match Go", () => {
    const rec = { type: "record" as const, userId: ID, rootId: ID, recordId: ID2, parents: [] as string[], commitmentHex: "ab".repeat(32), metaSealed: new Uint8Array(), bodySealed: new Uint8Array(), nonceSealed: new Uint8Array(), logSeq: 1n, recordedAt: "2026-11-14T05:12:03Z" };
    expect(() => messageFor(rec)).not.toThrow();
    expect(() => messageFor({ ...rec, logSeq: -1n })).toThrow("bad_field");
    expect(() => messageFor({ ...rec, logSeq: 2n ** 64n })).toThrow("bad_field");
    expect(() => messageFor({ ...rec, commitmentHex: "cc" })).toThrow("bad_field");
    expect(() => messageFor({ ...rec, recordedAt: "2026-11-14 05:12:03" })).toThrow("bad_field");
    expect(() => messageFor({ ...rec, parents: [ID, ID] })).toThrow("bad_field");
    expect(() => messageFor({ type: "repo_head", userId: ID, engineId: ID2, commitSha: "xyz", unixTs: 1n })).toThrow("bad_field");
  });
});

describe("record message from the server's stored hashes (M5a, spec §8)", () => {
  for (const v of data.vectors.filter((x) => x.name.startsWith("record"))) {
    it(`${v.name}: same bytes and signature as the full record`, () => {
      const i = inputOf(v);
      const msg = messageFor({
        type: "record_hashed", userId: i.user_id, rootId: i.root_id, recordId: i.record_id, parents: i.parents ? i.parents.split(",") : [],
        commitmentHex: i.commitment_hex, metaSealed: fromHex(i.meta_sealed_hex),
        bodyHashHex: toHex(sha256(fromHex(i.body_sealed_hex))), nonceHashHex: toHex(sha256(fromHex(i.nonce_sealed_hex))),
        logSeq: BigInt(i.log_seq), recordedAt: i.recorded_at,
      });
      expect(toHex(msg)).toBe(v.message_hex);
      expect(verify(fromHex(data.public_hex), msg, v.signature_b64u)).toBe(true);
    });
  }
  it("refuses hashes that are not lowercase hex of 64 characters", () => {
    const base = { type: "record_hashed" as const, userId: ID, rootId: ID, recordId: ID2, parents: [], commitmentHex: "a".repeat(64), metaSealed: new Uint8Array([1]),
      bodyHashHex: "b".repeat(64), nonceHashHex: "c".repeat(64), logSeq: 1n, recordedAt: "2026-11-14T05:12:03Z" };
    expect(() => messageFor(base)).not.toThrow();
    expect(() => messageFor({ ...base, bodyHashHex: "B".repeat(64) })).toThrow("bad_field");
    expect(() => messageFor({ ...base, nonceHashHex: "c".repeat(63) })).toThrow("bad_field");
    expect(() => messageFor({ ...base, bodyHashHex: `${"b".repeat(63)}\n` })).toThrow("bad_field");
  });
});
