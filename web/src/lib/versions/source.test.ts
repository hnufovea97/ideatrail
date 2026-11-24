import { describe, expect, it } from "vitest";
import { fakeGithub } from "../testing/fake-github";
import { fakeWorld, linkRow, syncOf } from "../testing/fake-world";
import { loadSource } from "./source";

const RID = "01hzzzzzzzzzzzzzzzzzzzzzzz".slice(0, 26);
const BUNDLE = JSON.stringify({ v: 1, record_id: RID, commitment: "ab".repeat(32), nonce_sealed: "AAAA" });
const enc = new TextEncoder();

async function setup(files: Record<string, Uint8Array>, linked = true, status?: number) {
  const w = fakeWorld();
  const gh = fakeGithub({ files, contentsStatus: status });
  const links = linked ? syncOf({ links: [await linkRow(w)] }).links.values() : [];
  return { w, gh, deps: { vault: w.vault, links, github: gh.fetch } };
}

describe("version source (5.13)", () => {
  it("no GitHub link: unlinked, and GitHub is never asked", async () => {
    const { gh, deps } = await setup({}, false);
    expect(await loadSource(deps, RID)).toEqual({ kind: "unlinked" });
    expect(gh.calls).toEqual([]);
  });

  it("bundle.json not in the repo yet (404): not_yet", async () => {
    const { deps } = await setup({});
    expect(await loadSource(deps, RID)).toEqual({ kind: "not_yet" });
  });

  it("bundle.json there: ready with its commitment and sealed nonce", async () => {
    const { gh, deps } = await setup({ [`proofs/${RID}/bundle.json`]: enc.encode(BUNDLE) });
    const s = await loadSource(deps, RID);
    expect(s).toEqual({ kind: "ready", bundle: { commitment: "ab".repeat(32), nonceSealed: "AAAA" } });
    expect(gh.calls.every((c) => c.auth === "Bearer fake-token-for-tests")).toBe(true);
    expect(gh.calls.map((c) => c.path + JSON.stringify(c.body)).join()).not.toContain("fake-token-for-tests");
  });

  it("GitHub refuses, or the bundle is not what the engine writes: failed", async () => {
    expect(await loadSource((await setup({}, true, 500)).deps, RID)).toEqual({ kind: "failed" });
    const junk = await setup({ [`proofs/${RID}/bundle.json`]: enc.encode("{\"commitment\":1}") });
    expect(await loadSource(junk.deps, RID)).toEqual({ kind: "failed" });
  });

  it("a record id that is not an id never becomes a repo path", async () => {
    const { gh, deps } = await setup({});
    expect(await loadSource(deps, "../x")).toEqual({ kind: "failed" });
    expect(gh.calls).toEqual([]);
  });
});
