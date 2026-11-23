import { describe, expect, it } from "vitest";
import { newId } from "@ideatrail/crypto/ids";
import { randomKey } from "@ideatrail/crypto/keypair";
import { createApi, type Fetch } from "../api";
import { memoryStore } from "../engine-list";
import { pull } from "../sync/pull";
import { emptySync, type SyncState } from "../sync/store";
import { FakeServer } from "../testing/fake-server";
import { deltaRow, fakeWorld, recordRow, rootRow, type World } from "../testing/fake-world";
import { mergeAll, MERGE_ATTEMPTS } from "./merge";
import { openRootMeta } from "./root-meta";

const BASE = "http://fake.test";

async function setup() {
  const w = fakeWorld();
  const root = newId();
  const server = new FakeServer();
  server.add({
    roots: [rootRow(root)],
    records: [await recordRow(w, { rootId: root, seq: 1 })],
    deltas: [
      await deltaRow(w, { rootId: root, seq: 2, createdAt: "2026-11-11T00:00:00Z", body: { op: "tags", value: ["기획"] } }),
      await deltaRow(w, { rootId: root, seq: 3, createdAt: "2026-11-12T00:00:00Z", body: { op: "title", value: "가계부 앱 v2" } }),
    ],
  });
  return { w, root, server };
}

/** One browser tab: its own memory and marks, a full pull, then merge. */
async function tab(server: FakeServer, w: World, start: SyncState = emptySync(), f: Fetch = server.fetch) {
  const api = createApi(BASE, f);
  return mergeAll(api, w.vault, memoryStore(), await pull(api, start));
}

describe("merging fragments (5.3, spec §3.1.10 E)", () => {
  it("two tabs merging at once: one retries, both end with the same result", async () => {
    const { w, root, server } = await setup();
    const [a, b] = await Promise.all([tab(server, w), tab(server, w)]);
    expect(server.saves).toBe(2);
    expect(server.conflicts).toBe(1);
    expect(server.roots.get(root)!.meta_version).toBe(1);
    expect([...a.saved, ...b.saved]).toEqual([root]);
    expect(a.metas.get(root)).toEqual(b.metas.get(root));
    expect(openRootMeta(w.mk, w.userId, server.roots.get(root)!)).toEqual(a.metas.get(root));
    expect(a.metas.get(root)!.cells.title.value).toBe("가계부 앱 v2");
    expect([...server.deltas.values()].every((d) => d.merged_at !== null)).toBe(true);
    expect(a.pending || b.pending).toBe(false);
  });

  it("a fragment arriving during the race is folded in by the retry; the other tab catches up the same", async () => {
    const { w, root, server } = await setup();
    const late = await deltaRow(w, { rootId: root, seq: 4, createdAt: "2026-11-13T00:00:00Z", body: { op: "tags", value: ["협의"] } });
    server.beforeSave = () => server.add({ deltas: [late] });
    const [a, b] = await Promise.all([tab(server, w), tab(server, w)]);
    expect([server.saves, server.conflicts, server.roots.get(root)!.meta_version]).toEqual([3, 1, 2]);
    const loser = a.metas.get(root)!.version === 2 ? a : b;
    const winner = loser === a ? b : a;
    const caughtUp = await tab(server, w, winner.sync);
    expect(caughtUp.saved).toEqual([]);
    expect(caughtUp.metas.get(root)).toEqual(loser.metas.get(root));
    expect(loser.metas.get(root)!.cells.tags.value).toEqual(["협의"]);
  });

  it("a fragment the server marked merged on its own is still folded in, and not listed as open", async () => {
    const w = fakeWorld();
    const root = newId();
    const server = new FakeServer();
    const d = await deltaRow(w, { rootId: root, seq: 2, body: { op: "title", value: "몰래 지운 제목" } });
    server.add({ roots: [rootRow(root)], records: [await recordRow(w, { rootId: root, seq: 1 })], deltas: [{ ...d, merged_at: "2026-11-20T00:00:00Z" }] });
    const out = await tab(server, w);
    expect(out.saved).toEqual([root]);
    expect(out.metas.get(root)!.cells.title.value).toBe("몰래 지운 제목");
  });

  it("a forged fragment is never merged; nothing open means no request", async () => {
    const w = fakeWorld();
    const root = newId();
    const server = new FakeServer();
    server.add({ roots: [rootRow(root)], records: [await recordRow(w, { rootId: root, seq: 1 })],
      deltas: [await deltaRow(w, { rootId: root, seq: 2, body: { op: "title", value: "가짜" }, signer: randomKey() })] });
    const out = await tab(server, w);
    expect(server.saves).toBe(0);
    expect(out.issues.some((i) => i.kind === "bad_signature")).toBe(true);
    expect(out.metas.get(root)!.cells).toEqual({});
  });

  it("stops after MERGE_ATTEMPTS when another writer keeps winning, leaving the fragments open", async () => {
    const { w, server } = await setup();
    let posts = 0;
    const alwaysBehind: Fetch = async (input, init) => {
      if (init?.method !== "POST") return server.fetch(input, init);
      posts++;
      return new Response(JSON.stringify({ error: { code: "meta_version_conflict" } }), { status: 409 });
    };
    const out = await tab(server, w, emptySync(), alwaysBehind);
    expect(posts).toBe(MERGE_ATTEMPTS);
    expect(out.pending).toBe(true);
    expect(out.saved).toEqual([]);
  });
});
