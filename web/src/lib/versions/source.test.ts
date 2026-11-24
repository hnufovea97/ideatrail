import { describe, expect, it } from "vitest";
import { utf8 } from "@ideatrail/crypto/bytes";
import { fakeGithub } from "../testing/fake-github";
import { makeProof } from "../testing/fake-proofs";
import { fakeWorld, linkRow, syncOf } from "../testing/fake-world";
import { loadSource } from "./source";

const file = (path: string, text: string) => ({ path, bytes: utf8(text) });
const REF = { recordId: "01hzzzzzzzzzzzzzzzzzzzzzzz".slice(0, 26), rootId: "01hzzzzzzzzzzzzzzzzzzzzzzy".slice(0, 26), commitment: "ab".repeat(32), mainFile: "a.md" };

async function setup(files: Record<string, Uint8Array>, linked = true, status?: number) {
  const w = fakeWorld();
  const gh = fakeGithub({ files, contentsStatus: status });
  const links = linked ? syncOf({ links: [await linkRow(w)] }).links.values() : [];
  return { w, gh, deps: { vault: w.vault, links, github: gh.fetch } };
}

describe("version source (5.13, 5.6)", () => {
  it("no GitHub link: unlinked, and GitHub is never asked", async () => {
    const { gh, deps } = await setup({}, false);
    expect(await loadSource(deps, REF)).toEqual({ kind: "unlinked" });
    expect(gh.calls).toEqual([]);
  });

  it("bundle.json not in the repo yet (404): not_yet", async () => {
    expect(await loadSource((await setup({})).deps, REF)).toEqual({ kind: "not_yet" });
  });

  it("GitHub refuses, or the bundle is not what the engine writes: failed", async () => {
    expect(await loadSource((await setup({}, true, 500)).deps, REF)).toEqual({ kind: "failed" });
    const junk = await setup({ [`proofs/${REF.recordId}/bundle.json`]: utf8("{\"commitment\":1}") });
    expect(await loadSource(junk.deps, REF)).toEqual({ kind: "failed" });
  });

  it("a record id that is not an id never becomes a repo path", async () => {
    const { gh, deps } = await setup({});
    expect(await loadSource(deps, { ...REF, recordId: "../x" })).toEqual({ kind: "failed" });
    expect(gh.calls).toEqual([]);
  });

  it("found: opened and same; with an earlier text version, the line comparison (D2)", async () => {
    const w = fakeWorld();
    const first = await makeProof(w.ak.pub, w.userId, { files: [file("a.md", "가\n나\n")] });
    const second = await makeProof(w.ak.pub, w.userId, { rootId: first.ref.rootId, files: [file("a.md", "가\n다\n")] });
    const gh = fakeGithub({ files: { ...first.repo, ...second.repo } });
    const deps = { vault: w.vault, links: syncOf({ links: [await linkRow(w)] }).links.values(), github: gh.fetch };
    const s = await loadSource(deps, second.ref, first.ref);
    expect(s).toMatchObject({ kind: "ready", original: { kind: "opened", same: true } });
    expect(s.kind === "ready" && s.diff?.lines).toEqual([{ op: "same", text: "가" }, { op: "del", text: "나" }, { op: "add", text: "다" }]);
  });

  it("many files: found and checked, but no line comparison (D2)", async () => {
    const w = fakeWorld();
    const first = await makeProof(w.ak.pub, w.userId, { files: [file("a.md", "x")] });
    const many = await makeProof(w.ak.pub, w.userId, { rootId: first.ref.rootId, files: [file("a.md", "x"), file("b.md", "y")] });
    const gh = fakeGithub({ files: { ...first.repo, ...many.repo } });
    const deps = { vault: w.vault, links: syncOf({ links: [await linkRow(w)] }).links.values(), github: gh.fetch };
    expect(await loadSource(deps, many.ref, first.ref)).toMatchObject({ kind: "ready", original: { kind: "opened", same: true }, diff: null });
  });
});
