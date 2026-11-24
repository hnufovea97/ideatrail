import { toB64u, utf8 } from "@ideatrail/crypto/bytes";
import { serializeTimestamp } from "@ideatrail/crypto/ots";
import { describe, expect, it } from "vitest";
import { commit, fromHex, manifest, toHex } from "../commit";
import { version } from "../home/fixtures";
import type { VersionView } from "../model/read-model";
import { exportBundle, exportName, verifyBundle } from "./bundle";
import type { BlockInfo, Explorer } from "./explorers";

const nonce = new Uint8Array(32).map((_, i) => i + 1);
const text = utf8("첫 줄\n둘째 줄\n");
const HEIGHT = 870_100;

async function versionFor(content: Uint8Array, over: { anchor?: VersionView["server"]["anchor"]; receipt?: boolean } = {}): Promise<VersionView> {
  const commitment = toHex(await commit(nonce, content));
  const v = version({ anchor: over.anchor ?? "pending" });
  const receipt = over.receipt ? toB64u(serializeTimestamp({ msg: fromHex(commitment), attestations: [{ kind: "bitcoin", height: HEIGHT }], ops: [] })) : null;
  return { ...v, server: { ...v.server, commitment, receipt, blockHeight: over.anchor === "confirmed" ? HEIGHT : null } };
}
const chain = (v: VersionView): Explorer => ({ blockAt: async (): Promise<BlockInfo> => ({ hash: "ab".repeat(32), merkleRoot: toHex(fromHex(v.server.commitment).reverse()), time: 1_764_000_000 }) });

describe("exportBundle (spec §15 local copy)", () => {
  it("is the GitHub bundle with the nonce in plain hex, plus the receipt and height once confirmed", async () => {
    const v = await versionFor(text, { anchor: "confirmed", receipt: true });
    const b = exportBundle(v, nonce, false);
    expect(b).toEqual({
      v: 1, record_id: v.recordId, hash_alg: "sha256-nonce-v1", commitment: v.server.commitment, nonce: toHex(nonce), manifest: false,
      ots_complete: v.server.receipt, block_height: HEIGHT, recorded_at: v.server.recordedAt, engine_id: v.server.engineId, log_seq: v.server.logSeq,
    });
    expect(b).not.toHaveProperty("nonce_sealed");
  });
  it("before the browser's own check there is no block height (the server's hint is not a proof)", async () => {
    const v = await versionFor(text, { anchor: "server_confirmed", receipt: true });
    expect(exportBundle(v, nonce, false)).toMatchObject({ ots_complete: v.server.receipt, block_height: null });
    expect(exportBundle(await versionFor(text), nonce, false)).toMatchObject({ ots_complete: null, block_height: null });
  });
  it("names the file after the record, never after its content", async () => {
    const v = await versionFor(text);
    expect(exportName(v.recordId)).toBe(`${v.recordId}-증명.json`);
  });
});

describe("verifyBundle (pure: no server, no GitHub)", () => {
  it("an exported bundle with its original passes: ok (explorers agree)", async () => {
    const v = await versionFor(text, { anchor: "confirmed", receipt: true });
    const b = JSON.parse(JSON.stringify(exportBundle(v, nonce, false))); // as read back from the downloaded file
    expect(await verifyBundle(b, text, { a: chain(v), b: chain(v) })).toBe("ok");
    expect(await verifyBundle(b, text)).toBe("ok"); // offline: the receipt must still lead to a bitcoin block
  });
  it("one byte of the original changed → mismatch", async () => {
    const v = await versionFor(text, { anchor: "confirmed", receipt: true });
    const b = exportBundle(v, nonce, false);
    expect(await verifyBundle(b, utf8("첫 줄\n둘째 줄!\n"))).toBe("mismatch");
  });
  it("a GitHub bundle (nonce still sealed) → locked", async () => {
    const v = await versionFor(text);
    const { nonce: _n, ...rest } = exportBundle(v, nonce, false);
    expect(await verifyBundle({ ...rest, nonce_sealed: "AAEC" }, text)).toBe("locked");
  });
  it("content fits but no complete receipt yet → pending", async () => {
    const v = await versionFor(text);
    expect(await verifyBundle(exportBundle(v, nonce, false), text)).toBe("pending");
  });
  it("the explorers cannot answer → pending; they disagree → mismatch; the receipt does not hold → bad", async () => {
    const v = await versionFor(text, { anchor: "confirmed", receipt: true });
    const b = exportBundle(v, nonce, false);
    const down: Explorer = { blockAt: async () => { throw new Error("offline"); } };
    expect(await verifyBundle(b, text, { a: chain(v), b: down })).toBe("pending");
    const other: Explorer = { blockAt: async () => ({ hash: "cd".repeat(32), merkleRoot: toHex(fromHex(v.server.commitment).reverse()), time: 1 }) };
    expect(await verifyBundle(b, text, { a: chain(v), b: other })).toBe("mismatch");
    expect(await verifyBundle({ ...b, ots_complete: "AAEC" }, text)).toBe("bad");
  });
  it("many files: the manifest of the files is what the fingerprint covers", async () => {
    const files = [{ path: "README.md", content: utf8("b") }, { path: "docs/기획서.md", content: utf8("a") }];
    const v = await versionFor(await manifest(files));
    const b = exportBundle(v, nonce, true);
    expect(await verifyBundle(b, files)).toBe("pending");
    expect(await verifyBundle(b, [files[0], { path: "docs/기획서.md", content: utf8("x") }])).toBe("mismatch");
    expect(await verifyBundle(b, text)).toBe("mismatch"); // one blob is not a many-file version
  });
  it("anything that is not a bundle → bad", async () => {
    for (const junk of [null, "x", 5, {}, { v: 2 }, { v: 1, commitment: "zz", nonce: "00" }, { v: 1, commitment: "a".repeat(64), nonce: "xyz" }]) {
      expect(await verifyBundle(junk, text)).toBe("bad");
    }
  });
});
