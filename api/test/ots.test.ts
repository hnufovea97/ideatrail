import { describe, expect, it } from "vitest";
import { fromHex, toHex } from "@ideatrail/crypto/bytes";
import fx from "../../spec/vectors/ots/receipts.json";
import { bitcoinHeight, mergeInto, OtsError, parseOtsFile, parseTimestamp, pendingPoints, serializeTimestamp, type Timestamp } from "@ideatrail/crypto/ots";
import { aliceUpgrade } from "./fixtures";

const digest = fromHex(fx.digest_hex);

describe("OTS minimal parser (real M0 receipts)", () => {
  it("finds the single alice pending point in the pool's pending receipt", () => {
    const t = parseTimestamp(fromHex(fx.pending_alice_hex), digest);
    const points = pendingPoints(t);
    expect(points.map((p) => p.uri)).toEqual(["https://alice.btc.calendar.opentimestamps.org"]);
    expect(toHex(points[0].node.msg).startsWith(fx.alice_pending_msg_prefix)).toBe(true);
    expect(bitcoinHeight(t)).toBeNull();
  });

  it("round-trips bytes exactly", () => {
    for (const hex of [fx.pending_alice_hex, fx.pending_bob_hex]) {
      expect(toHex(serializeTimestamp(parseTimestamp(fromHex(hex), digest)))).toBe(hex);
    }
    const file = parseOtsFile(fromHex(fx.direct_alice_ots_hex));
    expect(toHex(file.digest)).toBe(fx.digest_hex);
    expect(fx.direct_alice_ots_hex.endsWith(toHex(serializeTimestamp(file.timestamp)))).toBe(true);
  });

  it("merging the calendar upgrade yields block 975755 and its merkle root", () => {
    const t = parseTimestamp(fromHex(fx.pending_alice_hex), digest);
    const up = aliceUpgrade();
    const point = pendingPoints(t)[0];
    expect(toHex(point.node.msg)).toBe(up.msgHex);
    mergeInto(point.node, parseTimestamp(up.bytes, point.node.msg));
    expect(bitcoinHeight(t)).toBe(fx.block_height);
    let root: Uint8Array | null = null;
    const walk = (n: Timestamp) => { if (n.attestations.some((a) => a.kind === "bitcoin")) root = n.msg; n.ops.forEach((o) => walk(o.next)); };
    walk(t);
    expect(toHex(root!)).toBe(fx.merkle_root_internal_hex);
    // re-parse the merged result: still valid and complete
    expect(bitcoinHeight(parseTimestamp(serializeTimestamp(t), digest))).toBe(fx.block_height);
  });

  it("an upgrade for a different message is refused", () => {
    const t = parseTimestamp(fromHex(fx.pending_alice_hex), digest);
    const up = aliceUpgrade();
    const point = pendingPoints(t)[0];
    expect(() => mergeInto(point.node, parseTimestamp(up.bytes, digest))).toThrow(OtsError);
  });

  it("rejects unknown ops, trailing bytes, truncation, oversize and deep trees", () => {
    expect(() => parseTimestamp(Uint8Array.of(0x02), digest)).toThrow(/unsupported op/); // sha1
    expect(() => parseTimestamp(Uint8Array.of(...fromHex(fx.pending_alice_hex), 0x00), digest)).toThrow(/trailing/);
    expect(() => parseTimestamp(fromHex(fx.pending_alice_hex).subarray(0, 20), digest)).toThrow(/truncated/);
    expect(() => parseTimestamp(new Uint8Array(9000), digest)).toThrow(/too large/);
    const deep = new Uint8Array(300).fill(0x08); // 300 nested sha256 ops
    expect(() => parseTimestamp(deep, digest)).toThrow(/too deep|too many nodes/);
    const wide = new Uint8Array(4000);
    for (let i = 0; i < 1333; i++) wide.set([0xff, 0x08], i * 2); // many sha256 branches
    expect(() => parseTimestamp(wide, digest)).toThrow(/too many nodes|truncated/);
    const grow = Uint8Array.of(0xf0, 0xff, 0x1f, ...new Uint8Array(4095), 0x08);
    expect(() => parseTimestamp(grow, digest)).toThrow(/message too long/);
    const unknownAtt = Uint8Array.of(0x00, 1, 2, 3, 4, 5, 6, 7, 8, 0x00);
    expect(() => parseTimestamp(unknownAtt, digest)).toThrow(/unsupported attestation/);
  });
});
