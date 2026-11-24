import { describe, expect, it } from "vitest";
import { newId } from "@ideatrail/crypto/ids";
import { createApi } from "../api";
import { memoryStore } from "../engine-list";
import { pull } from "../sync/pull";
import { emptySync } from "../sync/store";
import { FakeServer } from "../testing/fake-server";
import { deltaRow, fakeWorld, recordRow, rootRow } from "../testing/fake-world";
import { emptyRootMeta, type RootMetaV1 } from "./lww";
import { mergeAll } from "./merge";
import { openRootMeta, sealRootMeta } from "./root-meta";
import { saveStageNames } from "./stages-save";
import { stageNamesOf } from "./stages";

const E1 = "01jcm3v8q7s2kx4f9d6b5n0ta1";
const WRITING = ["착상", "개요", "초고", "퇴고", "발행"];
const OTHER = ["씨앗", "구상", "시안", "다듬기", "공개"];
const USER = ["하나", "둘", "셋", "넷", "다섯"];
const BASE = "http://fake.test";

async function setup() {
  const w = fakeWorld();
  const root = newId();
  const server = new FakeServer();
  server.add({ roots: [rootRow(root)], records: [await recordRow(w, { rootId: root, seq: 1 })] });
  return { w, root, server };
}
const tab = async (server: FakeServer) => {
  const api = createApi(BASE, server.fetch);
  return { api, sync: await pull(api, emptySync()) };
};

describe("saving the user's names", () => {
  it("seals the names into the root meta; nothing but the sealed blob is sent", async () => {
    const { w, root, server } = await setup();
    const t = await tab(server);
    const sent: string[] = [];
    const spy = createApi(BASE, async (input, init) => { if (init?.method === "POST") sent.push(String(init.body)); return server.fetch(input, init); });
    const out = await saveStageNames(spy, w.vault, memoryStore(), t.sync, root, USER, () => new Date("2026-11-24T03:00:00Z"));
    expect(stageNamesOf(out.meta)).toEqual(USER);
    expect(server.roots.get(root)!.meta_version).toBe(1);
    expect(stageNamesOf(openRootMeta(w.mk, w.userId, server.roots.get(root)!))).toEqual(USER);
    expect(sent).toHaveLength(1);
    for (const name of USER) expect(sent[0]).not.toContain(name);
  });
  it("the user's names beat an AI fragment that was open or arrives later", async () => {
    const { w, root, server } = await setup();
    server.add({ deltas: [await deltaRow(w, { rootId: root, seq: 2, createdAt: "2026-11-11T00:00:00Z", body: { op: "stages", value: WRITING } })] });
    const t = await tab(server);
    const saved = await saveStageNames(t.api, w.vault, memoryStore(), t.sync, root, USER, () => new Date("2026-11-12T00:00:00Z"));
    server.add({ deltas: [await deltaRow(w, { rootId: root, seq: 3, createdAt: "2026-11-30T00:00:00Z", body: { op: "stages", value: OTHER } })] });
    const t2 = await tab(server);
    const merged = await mergeAll(t2.api, w.vault, memoryStore(), t2.sync);
    expect(stageNamesOf(merged.metas.get(root)!)).toEqual(USER);
    expect(saved.meta.version).toBeGreaterThanOrEqual(1);
  });
  it("on a version conflict it merges again and retries; the user's save still lands", async () => {
    const { w, root, server } = await setup();
    const t = await tab(server);
    server.beforeSave = () => { // another device saved the root first
      const next: RootMetaV1 = { ...emptyRootMeta(), version: 1, cells: { title: { value: "다른 제목", at: "2026-11-12T00:00:00Z", engine: E1, seq: "1" } } };
      server.add({ roots: [rootRow(root, { meta_version: 1, list_meta: sealRootMeta(w.mk, w.userId, root, next) })] });
    };
    const out = await saveStageNames(t.api, w.vault, memoryStore(), t.sync, root, USER);
    expect(server.conflicts).toBe(1);
    expect(server.roots.get(root)!.meta_version).toBe(2);
    expect(stageNamesOf(out.meta)).toEqual(USER);
    expect(out.meta.cells.title.value).toBe("다른 제목"); // the other save is kept
  });
  it("two tabs saving at once end with the same names (the later save wins)", async () => {
    const { w, root, server } = await setup();
    const [a, b] = await Promise.all([tab(server), tab(server)]);
    await Promise.all([
      saveStageNames(a.api, w.vault, memoryStore(), a.sync, root, USER),
      saveStageNames(b.api, w.vault, memoryStore(), b.sync, root, OTHER),
    ]);
    const final = stageNamesOf(openRootMeta(w.mk, w.userId, server.roots.get(root)!));
    expect([USER, OTHER]).toContainEqual(final);
    const t = await tab(server);
    const merged = await mergeAll(t.api, w.vault, memoryStore(), t.sync);
    expect(stageNamesOf(merged.metas.get(root)!)).toEqual(final);
  });
  it("refuses names that are not five good ones, and an unreadable root", async () => {
    const { w, root, server } = await setup();
    const t = await tab(server);
    await expect(saveStageNames(t.api, w.vault, memoryStore(), t.sync, root, [...USER, "여섯"])).rejects.toThrow("bad_stage_names");
    await expect(saveStageNames(t.api, w.vault, memoryStore(), t.sync, newId(), USER)).rejects.toThrow("root_meta_unavailable");
    expect(server.saves).toBe(0);
  });
});
