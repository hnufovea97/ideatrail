import { describe, expect, it } from "vitest";
import { newId } from "@ideatrail/crypto/ids";
import { randomKey } from "@ideatrail/crypto/keypair";
import { ApiFailure, createApi, type Fetch } from "../api";
import { COPY } from "../copy";
import { memoryStore } from "../engine-list";
import { chainLine } from "../sync/chain";
import { emptySync } from "../sync/store";
import { fakeGithub } from "../testing/fake-github";
import { FakeServer } from "../testing/fake-server";
import { deltaRow, fakeWorld, linkRow, recordRow, rootRow } from "../testing/fake-world";
import { wipeVault } from "../unlock";
import { MAX_ROOT_META_PLAIN, sealRootMeta } from "../merge/root-meta";
import { RowCache } from "../sync/cache";
import { refresh, refreshFailure, type LoadDeps } from "./load";

const noGithub: Fetch = async () => { throw new Error("GitHub must not be called"); };
const deps = (server: FakeServer, github: Fetch = noGithub): LoadDeps =>
  ({ api: createApi("http://fake.test", server.fetch), github, marks: memoryStore(), now: () => new Date(2026, 10, 23, 9, 12), alive: () => true });

describe("one dashboard refresh", () => {
  it("a clean account: '정상', the idea, no GitHub call", async () => {
    const w = fakeWorld();
    const root = newId();
    const server = new FakeServer();
    server.add({ roots: [rootRow(root)], records: [await recordRow(w, { rootId: root, seq: 1 })] });
    const out = await refresh(deps(server), w.vault, emptySync());
    expect(chainLine(out.chain)).toBe("기록 사슬 정상 · 마지막 확인 9:12");
    expect(out.ideas.map((i) => i.locked.title)).toEqual(["가계부 앱"]);
    expect(out.mirror).toBe("none");
  });

  it("a forged fragment: the warning, never 정상, and nothing merged", async () => {
    const w = fakeWorld();
    const root = newId();
    const server = new FakeServer();
    server.add({ roots: [rootRow(root)], records: [await recordRow(w, { rootId: root, seq: 1 })],
      deltas: [await deltaRow(w, { rootId: root, seq: 2, body: { op: "title", value: "가짜" }, signer: randomKey() })] });
    const out = await refresh(deps(server), w.vault, emptySync());
    expect(chainLine(out.chain)).toBe(COPY.dash.chain.warn);
    expect(chainLine(out.chain)).not.toContain("정상");
    expect(server.saves).toBe(0);
    expect(out.ideas[0].locked.title).toBe("가계부 앱");
  });

  it("a gap: never 정상", async () => {
    const w = fakeWorld();
    const root = newId();
    const server = new FakeServer();
    server.add({ roots: [rootRow(root)], records: [await recordRow(w, { rootId: root, seq: 1 }), await recordRow(w, { rootId: root, seq: 3 })] });
    expect(chainLine((await refresh(deps(server), w.vault, emptySync())).chain)).not.toContain("정상");
  });

  it("a saved merge is mirrored to index/ with the engine's GitHub access", async () => {
    const w = fakeWorld();
    const root = newId();
    const server = new FakeServer();
    server.add({ roots: [rootRow(root)], records: [await recordRow(w, { rootId: root, seq: 1 })],
      deltas: [await deltaRow(w, { rootId: root, seq: 2, body: { op: "tags", value: ["협의"] } })], links: [await linkRow(w)] });
    const gh = fakeGithub();
    const out = await refresh(deps(server, gh.fetch), w.vault, emptySync());
    expect(out.mirror).toBe("done");
    expect(out.ideas[0].locked.tags).toEqual(["협의"]);
    expect(gh.calls.some((c) => c.method === "PATCH")).toBe(true);
    const again = await refresh(deps(server, noGithub), w.vault, out.sync);
    expect(again.mirror).toBe("none"); // nothing new merged: no write
  });

  async function withOpenFragment() {
    const w = fakeWorld();
    const root = newId();
    const server = new FakeServer();
    server.add({ roots: [rootRow(root)], records: [await recordRow(w, { rootId: root, seq: 1 })],
      deltas: [await deltaRow(w, { rootId: root, seq: 2, body: { op: "tags", value: ["협의"] } })], links: [await linkRow(w)] });
    return { w, server };
  }

  it("a lock landing just before the save: no seal, no save, no GitHub write", async () => {
    const { w, server } = await withOpenFragment();
    const gh = fakeGithub();
    const ctl = new AbortController();
    let checks = 0;
    const alive = () => {
      if (++checks === 1) { ctl.abort(); wipeVault(w.vault); } // the lock: abort first, then wipe the keys in place
      return !ctl.signal.aborted;
    };
    const out = await refresh({ ...deps(server, gh.fetch), alive }, w.vault, emptySync());
    expect(out).toMatchObject({ ideas: [], chain: { state: "checking" }, mirror: "none" });
    expect(checks).toBeGreaterThan(0);
    expect(server.saves).toBe(0);
    expect(gh.calls).toEqual([]);
  });

  it("a lock after the save but before the mirror: no GitHub write", async () => {
    const { w, server } = await withOpenFragment();
    const gh = fakeGithub();
    const ctl = new AbortController();
    const d = { ...deps(server, gh.fetch), alive: () => !ctl.signal.aborted };
    const save = server.fetch;
    d.api = createApi("http://fake.test", async (input, init) => {
      const res = await save(input, init);
      if (init?.method === "POST") { ctl.abort(); wipeVault(w.vault); }
      return res;
    });
    const out = await refresh(d, w.vault, emptySync());
    expect(server.saves).toBe(1);
    expect(gh.calls).toEqual([]);
    expect(out.mirror).toBe("none");
  });

  it("one root too large to save: the other root still shows and the line warns, never 정상", async () => {
    const w = fakeWorld();
    const [big, ok] = [newId(), newId()];
    const full = { v: 1 as const, version: 1, merged: {}, cells: { title: { value: "x".repeat(MAX_ROOT_META_PLAIN - 200), at: "2026-11-10T00:00:00Z", engine: "-", seq: "1" } } };
    const server = new FakeServer();
    const tags = Array.from({ length: 5 }, () => "가나다라마바사아자차");
    server.add({
      roots: [rootRow(big, { meta_version: 1, list_meta: sealRootMeta(w.mk, w.userId, big, full) }), rootRow(ok)],
      records: [await recordRow(w, { rootId: big, seq: 1 }), await recordRow(w, { rootId: ok, seq: 2 })],
      deltas: [await deltaRow(w, { rootId: big, seq: 3, body: { op: "tags", value: tags } })],
    });
    const out = await refresh(deps(server), w.vault, emptySync());
    expect(out.ideas).toHaveLength(2);
    expect(out.chain.state).toBe("warn");
  });

  it("a failed refresh says offline only when there was no answer", () => {
    expect(refreshFailure(new ApiFailure(0, "offline"))).toBe("offline");
    expect(refreshFailure(new ApiFailure(500, "unknown"))).toBe("failed");
    expect(refreshFailure(new ApiFailure(401, "session_required"))).toBe("failed");
    expect(refreshFailure(new Error("root_meta_invalid"))).toBe("failed");
  });

  it("a failed mirror stays dirty and is retried on the next refresh until it is done", async () => {
    const { w, server } = await withOpenFragment();
    const down: Fetch = async () => new Response("{}", { status: 503 });
    const first = await refresh(deps(server, down), w.vault, emptySync());
    expect([first.mirror, first.mirrorDirty]).toEqual(["failed", true]);
    const gh = fakeGithub();
    const second = await refresh(deps(server, gh.fetch), w.vault, first.sync, first.mirrorDirty);
    expect([second.mirror, second.mirrorDirty]).toEqual(["done", false]);
    expect(gh.calls.some((c) => c.method === "PATCH")).toBe(true);
  });

  it("never mirrors while any issue is open; the mirror stays dirty for later", async () => {
    const w = fakeWorld();
    const root = newId();
    const server = new FakeServer();
    server.add({ roots: [rootRow(root)], records: [await recordRow(w, { rootId: root, seq: 1 })],
      deltas: [await deltaRow(w, { rootId: root, seq: 2, body: { op: "tags", value: ["협의"] } }),
        await deltaRow(w, { rootId: root, seq: 3, body: { op: "title", value: "가짜" }, signer: randomKey() })], links: [await linkRow(w)] });
    const out = await refresh(deps(server, noGithub), w.vault, emptySync());
    expect(server.saves).toBe(1);
    expect(out.chain.state).toBe("warn");
    expect([out.mirror, out.mirrorDirty]).toEqual(["none", true]);
  });

  it("pins the first GitHub repo id: a link to another repo is refused with a warning", async () => {
    const { w, server } = await withOpenFragment();
    const d = deps(server, fakeGithub().fetch);
    const first = await refresh(d, w.vault, emptySync());
    expect(first.mirror).toBe("done");
    server.add({ links: [await linkRow(w, { token: "other-token", repo_full_name: "someone/else", repo_id: 99 }, "2026-11-20T00:00:00Z")],
      deltas: [await deltaRow(w, { rootId: [...server.roots.keys()][0], seq: 3, body: { op: "title", value: "새 제목" } })] });
    const gh = fakeGithub({ repoId: 99 });
    const second = await refresh({ ...d, github: gh.fetch }, w.vault, first.sync);
    expect(gh.calls).toEqual([]);
    expect(second.mirror).toBe("refused");
    expect(second.chain.state).toBe("warn");
  });

  it("keeps verified rows and opened metas across refreshes, and drops them when a refresh finds the vault locked", async () => {
    const { w, server } = await withOpenFragment();
    const cache = new RowCache();
    const d = { ...deps(server, fakeGithub().fetch), cache };
    const first = await refresh(d, w.vault, emptySync());
    expect(cache.size).toBeGreaterThan(0);
    await refresh(d, w.vault, first.sync);
    expect(cache.hits).toBe(2); // the unchanged record: its signature and its opened meta (the saved root and merged fragment are new rows)
    await refresh({ ...d, alive: () => false }, w.vault, first.sync);
    expect(cache.size).toBe(0);
  });

  it("a far-future fragment never wins the merge", async () => {
    const w = fakeWorld();
    const root = newId();
    const server = new FakeServer();
    server.add({ roots: [rootRow(root)], records: [await recordRow(w, { rootId: root, seq: 1 })],
      deltas: [await deltaRow(w, { rootId: root, seq: 2, createdAt: "2026-11-23T09:30:00Z", body: { op: "title", value: "미래에서 온 제목" } })] });
    const out = await refresh({ ...deps(server), now: () => new Date("2026-11-23T09:12:00Z") }, w.vault, emptySync());
    expect(server.saves).toBe(0);
    expect(out.ideas[0].locked.title).toBe("가계부 앱");
    expect(out.chain.state).toBe("warn");
  });
});
