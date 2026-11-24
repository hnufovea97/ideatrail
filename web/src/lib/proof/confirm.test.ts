import { toB64u } from "@ideatrail/crypto/bytes";
import { bitcoinPoints, parseTimestamp, serializeTimestamp, type Timestamp } from "@ideatrail/crypto/ots";
import { describe, expect, it } from "vitest";
import { toHex } from "../commit";
import { confirmAnchor } from "./confirm";
import type { BlockInfo, Explorer } from "./explorers";

const commitment = new Uint8Array(32).fill(9);
const HEIGHT = 870_000;
const TIME = 1_764_000_000;

/** commitment → append → sha256 → bitcoin attestation. The leaf message is the block's merkle root (internal order). */
const tree = (height = HEIGHT): Timestamp => ({ msg: commitment, attestations: [], ops: [
  { op: { kind: "append", arg: Uint8Array.of(1, 2, 3) }, next: { msg: new Uint8Array(), attestations: [], ops: [
    { op: { kind: "sha256" }, next: { msg: new Uint8Array(), attestations: [{ kind: "bitcoin", height }], ops: [] } },
  ] } },
] });
const receipt = (t: Timestamp = tree()) => toB64u(serializeTimestamp(t));
const rootOf = (b64: string) => {
  const bytes = Uint8Array.from(atob(b64.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
  return toHex(bitcoinPoints(parseTimestamp(bytes, commitment))[0].msg.slice().reverse()); // display order
};
const block = (merkleRoot: string, hash = "ab".repeat(32)): BlockInfo => ({ hash, merkleRoot, time: TIME });
const fake = (answer: (height: number) => Promise<BlockInfo>): Explorer => ({ blockAt: (h) => answer(h) });
const good = () => block(rootOf(receipt()));
const R = receipt();

describe("confirmAnchor (two explorers decide, the server's word does not count)", () => {
  it("both explorers show the receipt's block → confirmed with the height and the block time", async () => {
    const e = fake(async () => good());
    expect(await confirmAnchor(commitment, R, { a: e, b: e })).toEqual({ state: "confirmed", height: HEIGHT, time: new Date(TIME * 1000).toISOString() });
  });
  it("asks each explorer for the receipt's height and nothing else", async () => {
    const asked: number[] = [];
    const e = fake(async (h) => { asked.push(h); return good(); });
    await confirmAnchor(commitment, R, { a: e, b: e });
    expect(asked).toEqual([HEIGHT, HEIGHT]);
  });
  it("the two explorers disagree → mismatch (no confirmation)", async () => {
    const a = fake(async () => good());
    const b = fake(async () => block(rootOf(R), "cd".repeat(32)));
    expect(await confirmAnchor(commitment, R, { a, b })).toEqual({ state: "mismatch" });
    const c = fake(async () => block("00".repeat(32)));
    expect(await confirmAnchor(commitment, R, { a, b: c })).toEqual({ state: "mismatch" });
  });
  it("one explorer is down → checking, never confirmed", async () => {
    const down = fake(async () => { throw new Error("offline"); });
    const up = fake(async () => good());
    expect(await confirmAnchor(commitment, R, { a: up, b: down })).toEqual({ state: "checking" });
    expect(await confirmAnchor(commitment, R, { a: down, b: down })).toEqual({ state: "checking" });
  });
  it("a receipt that leads somewhere else than the chain shows → invalid", async () => {
    const other = fake(async () => block("11".repeat(32)));
    expect(await confirmAnchor(commitment, R, { a: other, b: other })).toEqual({ state: "invalid" });
  });
  it("a receipt for another fingerprint leads to another root → invalid", async () => {
    const e = fake(async () => good());
    expect(await confirmAnchor(new Uint8Array(32).fill(8), R, { a: e, b: e })).toEqual({ state: "invalid" });
  });
  it("a tampered, truncated, pending-only or oversized receipt → invalid, without asking any explorer", async () => {
    let asked = 0;
    const e = fake(async () => { asked++; return good(); });
    const bytes = serializeTimestamp(tree());
    const pending: Timestamp = { msg: commitment, attestations: [{ kind: "pending", uri: "https://a.example" }], ops: [] };
    for (const bad of [toB64u(bytes.slice(0, bytes.length - 3)), receipt(pending), "!!not-b64u", "", "A".repeat(20_000)]) {
      expect(await confirmAnchor(commitment, bad, { a: e, b: e })).toEqual({ state: "invalid" });
    }
    expect(asked).toBe(0);
  });
  it("no receipt yet (the server only has a hint) → checking", async () => {
    const e = fake(async () => good());
    expect(await confirmAnchor(commitment, null, { a: e, b: e })).toEqual({ state: "checking" });
  });
});
