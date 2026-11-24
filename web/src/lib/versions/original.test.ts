import { describe, expect, it } from "vitest";
import { utf8 } from "@ideatrail/crypto/bytes";
import { KIND, seal } from "@ideatrail/crypto/seal";
import { fakeGithub } from "../testing/fake-github";
import { makeProof, tarOf } from "../testing/fake-proofs";
import { fakeWorld } from "../testing/fake-world";
import { parseBundle } from "./bundle";
import { openOriginal, textOf } from "./original";
import { untar } from "./tar";
import type { RepoAccess } from "../mirror/github";

const ACCESS: RepoAccess = { token: "ghs_fake_for_tests", fullName: "me/ideatrail-proofs", repoId: 42 };
const file = (path: string, text: string) => ({ path, bytes: utf8(text) });

async function open(over: { files: ReturnType<typeof file>[]; original?: boolean; bundleCommitment?: string; edit?: (repo: Record<string, Uint8Array>) => void; signedCommitment?: string }) {
  const w = fakeWorld();
  const p = await makeProof(w.ak.pub, w.userId, over);
  over.edit?.(p.repo);
  const gh = fakeGithub({ files: p.repo });
  const bundle = parseBundle(p.repo[`proofs/${p.ref.recordId}/bundle.json`])!;
  const ref = { ...p.ref, commitment: over.signedCommitment ?? p.ref.commitment };
  return { gh, result: await openOriginal({ vault: w.vault, github: gh.fetch }, ACCESS, ref, bundle), p };
}

describe("openOriginal (5.6)", () => {
  it("one file: opened, and the fingerprint equals the signed one", async () => {
    const { result, p } = await open({ files: [file("기획.md", "첫 줄\n둘째 줄\n")] });
    expect(result).toMatchObject({ kind: "opened", same: true, manifest: false });
    expect(textOf(result)).toBe("첫 줄\n둘째 줄\n");
    expect(result.kind === "opened" && result.nonce).toEqual(p.nonce); // kept in memory for the user's own proof download
  });

  it("many files (tar, Korean names in PAX records): opened, same, no text to compare", async () => {
    const { result } = await open({ files: [file("docs/기획서.md", "a"), file("README.md", "b")] });
    expect(result.kind === "opened" && result.same).toBe(true);
    expect(result.kind === "opened" && result.files.map((f) => f.path)).toEqual(["README.md", "docs/기획서.md"]);
    expect(textOf(result)).toBeNull();
  });

  it("one byte changed in the original on GitHub: it still opens, but same is false", async () => {
    const w = fakeWorld();
    const p = await makeProof(w.ak.pub, w.userId, { files: [file("a.md", "hello")] });
    const aad = { userId: w.userId, rootId: p.ref.rootId, recordId: p.ref.recordId, version: "0" };
    const repo = { ...p.repo, [`proofs/${p.ref.recordId}/original.it1`]: await seal(KIND.original, w.ak.pub, aad, utf8("hellp")) };
    const gh = fakeGithub({ files: repo });
    const r = await openOriginal({ vault: w.vault, github: gh.fetch }, ACCESS, p.ref, parseBundle(repo[`proofs/${p.ref.recordId}/bundle.json`])!);
    expect(r).toMatchObject({ kind: "opened", same: false });
    expect(textOf(r)).toBeNull(); // a changed original is never offered for comparison
  });

  it("bundle.json carrying another commitment than the signed one: mismatch, original never read", async () => {
    const { result, gh } = await open({ files: [file("a.md", "x")], signedCommitment: "00".repeat(32) });
    expect(result).toEqual({ kind: "mismatch" });
    expect(gh.calls).toEqual([]);
  });

  it("no original.it1 (big or picture file): no_original", async () => {
    expect((await open({ files: [file("a.png", "x")], original: false })).result).toEqual({ kind: "no_original" });
  });

  it("an original sealed for another record does not open: unreadable", async () => {
    const w = fakeWorld();
    const a = await makeProof(w.ak.pub, w.userId, { files: [file("a.md", "x")] });
    const b = await makeProof(w.ak.pub, w.userId, { files: [file("a.md", "x")] });
    const repo = { ...a.repo, [`proofs/${a.ref.recordId}/original.it1`]: b.repo[`proofs/${b.ref.recordId}/original.it1`] };
    const gh = fakeGithub({ files: repo });
    const r = await openOriginal({ vault: w.vault, github: gh.fetch }, ACCESS, a.ref, parseBundle(repo[`proofs/${a.ref.recordId}/bundle.json`])!);
    expect(r).toEqual({ kind: "unreadable" });
  });

  it("never sends anything to GitHub but the two reads, token only in the header", async () => {
    const { gh } = await open({ files: [file("a.md", "비밀 내용")] });
    expect(gh.calls.every((c) => c.method === "GET" && c.body === null && c.auth === `Bearer ${ACCESS.token}`)).toBe(true);
    expect(gh.calls.map((c) => c.path).join()).not.toContain(ACCESS.token);
  });
});

describe("untar", () => {
  it("round-trips plain and PAX names, refuses cut or odd archives", () => {
    const files = [file("a.txt", "A"), file("폴더/나.md", "B".repeat(600))];
    expect(untar(tarOf(files))?.map((f) => [f.path, f.content.length])).toEqual([["a.txt", 1], ["폴더/나.md", 600]]);
    expect(untar(tarOf(files).subarray(0, 700))).toBeNull();
    expect(untar(utf8("not a tar"))).toBeNull();
  });
});
