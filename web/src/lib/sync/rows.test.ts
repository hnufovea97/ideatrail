import { describe, expect, it } from "vitest";
import { parsePage } from "./rows";

const ID = (c: string) => c.repeat(26);
const record = (over: Record<string, unknown> = {}) => ({
  record_id: ID("a"), root_id: ID("b"), parent_ids: "-", commitment: "c".repeat(64), hash_alg: "sha256-nonce-v1", manifest: 0, recorded_at: "2026-11-10T00:00:00Z",
  engine_id: ID("e"), log_seq: "1", engine_sig: "c2ln", list_meta: "SVQx", body_hash: "d".repeat(64), nonce_hash: "e".repeat(64), crypto_version: 1, deleted_at: null, change_seq: 3, ...over,
});

describe("sync rows (api/src/routes/sync.ts shapes)", () => {
  it("keeps well-formed rows with only the fields the dashboard uses", () => {
    const p = parsePage({ records: [record()] });
    expect(p.records).toHaveLength(1);
    expect(p.records[0]).not.toHaveProperty("hash_alg");
    expect(p.bad).toEqual([]);
  });
  it("drops a row with any wrong field and reports the table — never half-uses it", () => {
    for (const bad of [{ log_seq: "0" }, { log_seq: 5 }, { commitment: "C".repeat(64) }, { recorded_at: "2026-11-10 00:00:00" }, { parent_ids: "a,b" }, { record_id: "../x" }, { list_meta: "a+b" }]) {
      const p = parsePage({ records: [record(bad)] });
      expect(p.records).toEqual([]);
      expect(p.bad).toEqual(["records"]);
    }
  });
  it("anchors carry the complete receipt (base64url, capped) or null; anything else drops the row", () => {
    const anchor = (over: Record<string, unknown> = {}) => ({ record_id: ID("a"), status: "confirmed", block_height: 870_000, complete_receipt: "AAEC", change_seq: 4, ...over });
    expect(parsePage({ anchors: [anchor()] }).anchors[0].complete_receipt).toBe("AAEC");
    expect(parsePage({ anchors: [anchor({ complete_receipt: null })] }).anchors).toHaveLength(1);
    for (const bad of [{ complete_receipt: "a+b" }, { complete_receipt: "A".repeat(11_001) }, { complete_receipt: "" }, { complete_receipt: 5 }, { complete_receipt: undefined }]) {
      expect(parsePage({ anchors: [anchor(bad)] }).bad).toEqual(["anchors"]);
    }
  });
  it("a table that is not a list is reported; missing tables are just empty", () => {
    const p = parsePage({ deltas: "nope" });
    expect(p.bad).toEqual(["deltas"]);
    expect(p.roots).toEqual([]);
  });
});
