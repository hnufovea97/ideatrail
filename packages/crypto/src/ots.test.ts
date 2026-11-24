import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { bitcoinPoints, parseTimestamp, serializeTimestamp, type Timestamp } from "./ots";

const start = new Uint8Array(32).fill(7);

describe("bitcoinPoints", () => {
  it("returns each bitcoin attestation with its node message, lowest height first", () => {
    const hashed = sha256(start);
    const tree: Timestamp = { msg: start, attestations: [{ kind: "pending", uri: "https://a.example" }], ops: [
      { op: { kind: "sha256" }, next: { msg: hashed, attestations: [{ kind: "bitcoin", height: 900 }, { kind: "bitcoin", height: 850 }], ops: [] } },
    ] };
    const points = bitcoinPoints(parseTimestamp(serializeTimestamp(tree), start));
    expect(points.map((p) => p.height)).toEqual([850, 900]);
    expect(points[0].msg).toEqual(hashed);
  });
  it("is empty while the receipt is only pending", () => {
    const tree: Timestamp = { msg: start, attestations: [{ kind: "pending", uri: "https://a.example" }], ops: [] };
    expect(bitcoinPoints(parseTimestamp(serializeTimestamp(tree), start))).toEqual([]);
  });
});
