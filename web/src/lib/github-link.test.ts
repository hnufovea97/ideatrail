import { describe, expect, it } from "vitest";
import { toB64u } from "@ideatrail/crypto/bytes";
import { randomKey, signPublicKey } from "@ideatrail/crypto/keypair";
import { messageFor, sign } from "@ideatrail/crypto/sign";
import type { Api, StorageLinkRow } from "./api";
import { findStorageLink, storageLinkValid } from "./github-link";

const USER = "01jcm3v8q7s2kx4f9d6b5n0tqw";
const ENGINE = "01jcm3v8q7s2kx4f9d6b5n0tqx";
const seed = randomKey();
const engine = { engine_id: ENGINE, sign_pubkey: toB64u(signPublicKey(seed)), kem_pubkey: "k", name: "n", added_at: "x" };

function row(over: Partial<StorageLinkRow> = {}, signer = seed): StorageLinkRow {
  const token = Uint8Array.of(0x49, 0x54, 0x31, 6, 1, 2, 3);
  const unixTs = 1_763_000_000n;
  const sig = sign(signer, messageFor({ type: "storage_link", userId: USER, engineId: ENGINE, tokenSealed: token, unixTs }));
  return { link_id: "l", engine_id: ENGINE, provider: "github", enc_token: toB64u(token), engine_sig: sig, created_at: new Date(Number(unixTs) * 1000).toISOString(), revoked_at: null, ...over };
}

describe("GitHub link done = engine-signed storage link (spec §8)", () => {
  it("accepts the engine's own signature", () => expect(storageLinkValid(row(), engine, USER)).toBe(true));
  it("rejects another signer, a revoked row, another engine, a changed time", () => {
    expect(storageLinkValid(row({}, randomKey()), engine, USER)).toBe(false);
    expect(storageLinkValid(row({ revoked_at: "2026-11-18T00:00:00Z" }), engine, USER)).toBe(false);
    expect(storageLinkValid(row({ engine_id: USER }), engine, USER)).toBe(false);
    expect(storageLinkValid(row({ created_at: "2026-11-18T00:00:00Z" }), engine, USER)).toBe(false);
  });
  it("follows sync pages until next_cursor is null", async () => {
    const pages = [
      { changes: { storage_links: [] }, cursor: 5, next_cursor: 5 },
      { changes: { storage_links: [row()] }, cursor: 9, next_cursor: null },
    ];
    const seen: number[] = [];
    const api = { sync: async (c: number) => { seen.push(c); return pages[seen.length - 1]; } } as unknown as Api;
    expect(await findStorageLink(api, 0, engine, USER)).toEqual({ linked: true, cursor: 9 });
    expect(seen).toEqual([0, 5]);
  });
});
