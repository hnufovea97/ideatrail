import { describe, expect, it } from "vitest";
import data from "../../../spec/vectors/commitment.json";
import { commit, manifest, fromHex, toHex } from "./commit";

describe("sha256-nonce-v1", () => {
  for (const v of data.vectors) {
    it(v.name, async () => {
      const nonce = fromHex(v.nonce_hex);
      if ("expect_error" in v && v.expect_error) {
        await expect(manifest(v.manifest_entries!.map((e) => ({ path: e.path, content: fromHex(e.content_hex) })))).rejects.toThrow(v.expect_error);
      } else if ("manifest_entries" in v && v.manifest_entries) {
        const m = manifest(v.manifest_entries.map((e) => ({ path: e.path, content: fromHex(e.content_hex) })));
        expect(toHex(await m)).toBe(v.manifest_hex);
        expect(toHex(await commit(nonce, await m))).toBe(v.commitment_hex);
      } else {
        expect(toHex(await commit(nonce, fromHex(v.content_hex!)))).toBe(v.commitment_hex);
      }
    });
  }
});
