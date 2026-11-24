import { describe, expect, it } from "vitest";
import { newId } from "@ideatrail/crypto/ids";
import { unlock } from "@ideatrail/crypto/relock";
import { subkey } from "@ideatrail/crypto/subkey";
import { memoryStore } from "../engine-list";
import { emptyRootMeta } from "../merge/lww";
import { openRecordMeta } from "../model/meta";
import { verifyRows } from "../sync/verify";
import { fakeGithub } from "../testing/fake-github";
import { fakeWorld, linkRow, recordRow, rootRow, syncOf } from "../testing/fake-world";
import { commitIndex, COMMIT_ATTEMPTS, GithubFailure, INDEX_MESSAGE, readRepoFile, type RepoAccess } from "./github";
import { INDEX_RECORDS, INDEX_ROOTS, indexFiles } from "./index-files";
import { openRepoAccess } from "./storage";

const ACCESS: RepoAccess = { token: "ghs_fake_for_tests", fullName: "me/ideatrail-proofs", repoId: 42 };
const FILES = { [INDEX_ROOTS]: new Uint8Array([1]), [INDEX_RECORDS]: new Uint8Array([2]) };
type Tree = { base_tree: string; tree: { path: string; mode: string }[] };

describe("index/ mirror (spec §12, §15 M5a)", () => {
  it("one commit with both index files; the token only in the Authorization header", async () => {
    const gh = fakeGithub();
    await commitIndex(gh.fetch, ACCESS, FILES);
    const tree = gh.calls.find((c) => c.method === "POST" && c.path.endsWith("/git/trees"))!.body as Tree;
    expect(tree.tree.map((t) => t.path).sort()).toEqual([INDEX_RECORDS, INDEX_ROOTS]);
    expect(tree.tree.every((t) => t.mode === "100644")).toBe(true);
    expect(tree.base_tree).toMatch(/^[0-9a-f]{40}$/);
    expect((gh.calls.find((c) => c.method === "POST" && c.path.endsWith("/git/commits"))!.body as { message: string }).message).toBe(INDEX_MESSAGE);
    expect((gh.calls.find((c) => c.method === "PATCH")!.body as { force: boolean }).force).toBe(false);
    for (const c of gh.calls) {
      expect(c.auth).toBe(`Bearer ${ACCESS.token}`);
      expect(c.path + JSON.stringify(c.body)).not.toContain(ACCESS.token);
    }
  });

  it("every GitHub request carries the lock's abort signal", async () => {
    const gh = fakeGithub();
    const signals: (AbortSignal | null | undefined)[] = [];
    const ctl = new AbortController();
    await commitIndex(async (input, init) => { signals.push(init?.signal); return gh.fetch(input, init); }, ACCESS, FILES, ctl.signal);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((s) => s === ctl.signal)).toBe(true);
  });

  it("retries a ref that moved, at most COMMIT_ATTEMPTS times", async () => {
    const twice = fakeGithub({ refConflicts: 2 });
    await commitIndex(twice.fetch, ACCESS, FILES);
    expect(twice.calls.filter((c) => c.method === "PATCH")).toHaveLength(3);
    const always = fakeGithub({ refConflicts: 99 });
    const err = await commitIndex(always.fetch, ACCESS, FILES).catch((e) => e);
    expect(err).toBeInstanceOf(GithubFailure);
    expect(err.status).toBe(422);
    expect(always.calls.filter((c) => c.method === "PATCH")).toHaveLength(COMMIT_ATTEMPTS);
  });

  it("never writes to a repo whose id is not the sealed one, or to a public repo", async () => {
    for (const gh of [fakeGithub({ repoId: 7 }), fakeGithub({ isPrivate: false })]) {
      const err = await commitIndex(gh.fetch, ACCESS, FILES).catch((e) => e);
      expect(err.code).toBe("repo_mismatch");
      expect(gh.calls.filter((c) => c.method !== "GET")).toEqual([]);
    }
    const odd = fakeGithub();
    expect((await commitIndex(odd.fetch, { ...ACCESS, fullName: "../../evil" }, FILES).catch((e) => e)).code).toBe("bad_repo");
    expect(odd.calls).toEqual([]);
  });

  it("index files open with their own subkeys and hold the merged meta and the record meta", async () => {
    const w = fakeWorld();
    const root = newId();
    const rec = await recordRow(w, { rootId: root, seq: 1 });
    const s = syncOf({ roots: [rootRow(root)], records: [rec] });
    const v = verifyRows(w.userId, w.list, s, memoryStore());
    const recMeta = (await openRecordMeta(w.ak.priv, w.userId, rec))!;
    const files = indexFiles(w.vault, s, v, new Map([[root, { ...emptyRootMeta(), version: 1 }]]), new Map([[rec.record_id, recMeta]]));
    const read = (purpose: "index_roots" | "index_records", path: string) =>
      JSON.parse(new TextDecoder().decode(unlock(subkey(w.mk, purpose), purpose, { userId: w.userId }, files[path])));
    expect(read("index_roots", INDEX_ROOTS).roots).toEqual([{ root_id: root, visibility: "private", meta_version: 1, meta: { ...emptyRootMeta(), version: 1 } }]);
    expect(read("index_records", INDEX_RECORDS).records[0]).toMatchObject({ record_id: rec.record_id, root_id: root, log_seq: "1", commitment: rec.commitment, meta: { title: "가계부 앱" } });
  });

  it("refuses to build index files with a wiped master key", async () => {
    const w = fakeWorld();
    const s = syncOf({});
    const v = verifyRows(w.userId, w.list, s, memoryStore());
    w.mk.fill(0);
    expect(() => indexFiles(w.vault, s, v, new Map(), new Map())).toThrow("zero_key");
  });

  it("opens the GitHub access from a storage link a listed engine signed — nothing else", async () => {
    const w = fakeWorld();
    const link = await linkRow(w);
    expect(await openRepoAccess(w.vault, w.list, [link])).toEqual({ token: "fake-token-for-tests", fullName: "me/ideatrail-proofs", repoId: 42 });
    const forged = { ...link, engine_sig: (await linkRow(fakeWorld())).engine_sig };
    expect(await openRepoAccess(w.vault, w.list, [forged])).toBeNull();
    expect(await openRepoAccess(w.vault, { ...w.list, engines: [] }, [link])).toBeNull();
    const revoked = (extra: Record<string, string>) => ({ ...w.list, engines: [{ ...w.engine.entry, ...extra }] });
    expect(await openRepoAccess(w.vault, revoked({ revoked_at: "2026-11-20T00:00:00Z", revoked_after_seq: "9" }), [link])).toBeNull();
    expect(await openRepoAccess(w.vault, revoked({ revoked_after_seq: "9" }), [link])).toBeNull(); // a disconnected engine's access is never used
  });
});

describe("readRepoFile (5.6)", () => {
  it("raw bytes for a file, null for a 404, the token only in the header", async () => {
    const gh = fakeGithub({ files: { "proofs/a/bundle.json": new Uint8Array([1, 2, 3]) } });
    expect(await readRepoFile(gh.fetch, ACCESS, "proofs/a/bundle.json")).toEqual(new Uint8Array([1, 2, 3]));
    expect(await readRepoFile(gh.fetch, ACCESS, "proofs/b/bundle.json")).toBeNull();
    expect(gh.calls.every((c) => c.method === "GET" && c.auth === `Bearer ${ACCESS.token}` && !c.path.includes(ACCESS.token))).toBe(true);
  });
  it("refuses a path that climbs out and turns a GitHub refusal into GithubFailure without the token", async () => {
    const gh = fakeGithub({ contentsStatus: 403 });
    expect((await readRepoFile(gh.fetch, ACCESS, "proofs/../x").catch((e) => e)).code).toBe("bad_repo");
    const err = await readRepoFile(gh.fetch, ACCESS, "proofs/a/bundle.json").catch((e) => e);
    expect(err).toBeInstanceOf(GithubFailure);
    expect(`${err.message}${err.stack}`).not.toContain(ACCESS.token);
  });
});
