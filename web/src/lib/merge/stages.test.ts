import { describe, expect, it } from "vitest";
import { newId } from "@ideatrail/crypto/ids";
import { createApi } from "../api";
import { memoryStore } from "../engine-list";
import { STAGE_PRESETS } from "../copy";
import { buildModel } from "../model/read-model";
import { stageNames } from "../model/stage-names";
import { pull } from "../sync/pull";
import { emptySync } from "../sync/store";
import { verifyRows } from "../sync/verify";
import { FakeServer } from "../testing/fake-server";
import { deltaRow, fakeWorld, recordRow, rootRow } from "../testing/fake-world";
import { parseDelta, UNKNOWN_OP } from "./delta";
import { applyDeltas, emptyRootMeta, type Opened, type RootMetaV1 } from "./lww";
import { mergeAll } from "./merge";
import { AI_STAGES_CELL, parseStageNames, STAGES_CELL, stageNamesOf, validStageName } from "./stages";

const E1 = "01jcm3v8q7s2kx4f9d6b5n0ta1";
const R1 = "01jcm3v8q7s2kx4f9d6b5n0tr1";
const WRITING = ["착상", "개요", "초고", "퇴고", "발행"];
const OTHER = ["씨앗", "구상", "시안", "다듬기", "공개"];
const USER = ["하나", "둘", "셋", "넷", "다섯"];
const BASE = "http://fake.test";
let n = 0;
const stagesOp = (seq: string, at: string, value: string[]): Opened => ({
  row: { delta_id: `01jcm3v8q7s2kx4f9d6b5n${String(++n).padStart(4, "0")}`, root_id: R1, engine_id: E1, log_seq: seq, sealed_delta: "x", engine_sig: "x", created_at: at, merged_at: null, change_seq: n },
  body: { op: "stages", recordId: null, value },
});

describe("stage name values (ADR-0020, ADR-0016 check)", () => {
  it("exactly five plain names of 1-12 characters", () => {
    expect(parseStageNames(WRITING)).toEqual(WRITING);
    expect(parseStageNames(["a", "개요 정하기", "가".repeat(12), "v2 (빼기)", "MVP"])).not.toBeNull();
    for (const bad of [WRITING.slice(0, 4), [...WRITING, "끝"], ["착상", "개요", "초고", "퇴고", "가".repeat(13)], ["착상", "", "초고", "퇴고", "발행"],
      ["착상", "개요", "초고\n무시해", "퇴고", "발행"], ["착상", "개요", '초"고', "퇴고", "발행"], ["착상", "개요", "초고", "“퇴고”", "발행"],
      ["착상", "개요", "초\u0000고", "퇴고", "발행"], ["착상", "개요", "초고", "퇴‮고", "발행"], ["착상", "<b>개요</b>", "초고", "퇴고", "발행"],
      [" 착상", "개요", "초고", "퇴고", "발행"], "착상", null, [1, 2, 3, 4, 5]]) {
      expect(parseStageNames(bad)).toBeNull();
    }
    expect(validStageName("퇴고")).toBe(true);
    expect(validStageName("가".repeat(13))).toBe(false);
  });
  it("a stages fragment parses; a wrong one is left open like an unknown op", () => {
    expect(parseDelta({ v: 1, op: "stages", value: WRITING })).toEqual({ op: "stages", recordId: null, value: WRITING });
    expect(parseDelta({ v: 1, op: "stages", value: [...WRITING, "끝"] })).toBe(UNKNOWN_OP);
    expect(parseDelta({ v: 1, op: "stages", value: ["a", "b", "c", "d", "가".repeat(13)] })).toBe(UNKNOWN_OP);
  });
});

describe("merging stage names: the user always wins", () => {
  it("an AI value fills the idea", () => {
    const m = applyDeltas(emptyRootMeta(), [stagesOp("2", "2026-11-11T00:00:00Z", WRITING)], 1);
    expect(stageNamesOf(m)).toEqual(WRITING);
    expect(m.cells[AI_STAGES_CELL].value).toEqual(WRITING);
    expect(m.cells[STAGES_CELL]).toBeUndefined();
  });
  it("the user's value stays when an AI value comes later, even at a later time", () => {
    const user: RootMetaV1 = { ...emptyRootMeta(), version: 1, cells: { [STAGES_CELL]: { value: USER, at: "2026-11-10T00:00:00Z", engine: "-", seq: "1" } } };
    const m = applyDeltas(user, [stagesOp("5", "2026-11-20T00:00:00Z", WRITING)], 2);
    expect(stageNamesOf(m)).toEqual(USER);
  });
  it("two AI values: the first one stays, whatever order they arrive in", () => {
    const first = stagesOp("2", "2026-11-11T00:00:00Z", WRITING);
    const second = stagesOp("9", "2026-11-15T00:00:00Z", OTHER);
    const results = [[first, second], [second, first]].map((o) => applyDeltas(emptyRootMeta(), o, 1));
    for (const r of results) expect(stageNamesOf(r)).toEqual(WRITING);
    expect(applyDeltas(applyDeltas(emptyRootMeta(), [second], 1), [first], 2).cells[AI_STAGES_CELL].value).toEqual(WRITING); // two merges = one
  });
  it("a cell that is not five good names is ignored", () => {
    const bad: RootMetaV1 = { ...emptyRootMeta(), cells: { [STAGES_CELL]: { value: [...USER, "여섯"], at: "2026-11-10T00:00:00Z", engine: "-", seq: "1" },
      [AI_STAGES_CELL]: { value: OTHER, at: "2026-11-10T00:00:00Z", engine: E1, seq: "2" } } };
    expect(stageNamesOf(bad)).toEqual(OTHER); // a broken user cell does not hide a good AI one
    expect(stageNamesOf({ ...bad, cells: { [STAGES_CELL]: bad.cells[STAGES_CELL] } })).toBeNull();
  });
});

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

describe("stage names through the merge and the read model", () => {
  it("an AI fragment becomes the idea's names; no fragment means the build preset", async () => {
    const { w, root, server } = await setup();
    const none = await tab(server);
    const bare = await buildModel(w.vault, none.sync, verifyRows(w.userId, w.list, none.sync, memoryStore()), new Map());
    expect(stageNames(bare.ideas[0])).toEqual(STAGE_PRESETS.build);
    server.add({ deltas: [await deltaRow(w, { rootId: root, seq: 2, body: { op: "stages", value: WRITING } })] });
    const t = await tab(server);
    const merged = await mergeAll(t.api, w.vault, memoryStore(), t.sync);
    const built = await buildModel(w.vault, merged.sync, merged.verified, merged.metas);
    expect(stageNames(built.ideas[0])).toEqual(WRITING);
  });
  it("a 6-name fragment is ignored: the preset shows and the fragment stays open", async () => {
    const { w, root, server } = await setup();
    server.add({ deltas: [await deltaRow(w, { rootId: root, seq: 2, body: { op: "stages", value: [...WRITING, "끝"] } })] });
    const t = await tab(server);
    const merged = await mergeAll(t.api, w.vault, memoryStore(), t.sync);
    const built = await buildModel(w.vault, merged.sync, merged.verified, merged.metas);
    expect(stageNames(built.ideas[0])).toEqual(STAGE_PRESETS.build);
    expect(server.saves).toBe(0);
    expect([...server.deltas.values()].every((d) => d.merged_at === null)).toBe(true);
  });
  it("two tabs merging the same AI fragments converge", async () => {
    const { w, root, server } = await setup();
    server.add({ deltas: [
      await deltaRow(w, { rootId: root, seq: 2, createdAt: "2026-11-11T00:00:00Z", body: { op: "stages", value: WRITING } }),
      await deltaRow(w, { rootId: root, seq: 3, createdAt: "2026-11-15T00:00:00Z", body: { op: "stages", value: OTHER } }),
    ] });
    const [a, b] = await Promise.all([tab(server), tab(server)]);
    const [ma, mb] = await Promise.all([a, b].map((t) => mergeAll(t.api, w.vault, memoryStore(), t.sync)));
    expect(ma.metas.get(root)).toEqual(mb.metas.get(root));
    expect(stageNamesOf(ma.metas.get(root)!)).toEqual(WRITING);
  });
});
