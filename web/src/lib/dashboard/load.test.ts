import { describe, expect, it } from "vitest";
import { newId } from "@ideatrail/crypto/ids";
import { randomKey } from "@ideatrail/crypto/keypair";
import { createApi, type Fetch } from "../api";
import { COPY } from "../copy";
import { memoryStore } from "../engine-list";
import { chainLine } from "../sync/chain";
import { emptySync } from "../sync/store";
import { fakeGithub } from "../testing/fake-github";
import { FakeServer } from "../testing/fake-server";
import { deltaRow, fakeWorld, linkRow, recordRow, rootRow } from "../testing/fake-world";
import { refresh, type LoadDeps } from "./load";

const noGithub: Fetch = async () => { throw new Error("GitHub must not be called"); };
const deps = (server: FakeServer, github: Fetch = noGithub): LoadDeps =>
  ({ api: createApi("http://fake.test", server.fetch), github, marks: memoryStore(), now: () => new Date(2026, 10, 23, 9, 12) });

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
});
