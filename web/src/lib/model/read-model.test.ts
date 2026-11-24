import { describe, expect, it } from "vitest";
import { newId } from "@ideatrail/crypto/ids";
import { newKemKeyPair } from "@ideatrail/crypto/keypair";
import { memoryStore } from "../engine-list";
import type { RootMetaV1 } from "../merge/lww";
import { META, anchorRow, fakeWorld, recordRow, rootRow, syncOf } from "../testing/fake-world";
import { verifyRows } from "../sync/verify";
import { buildModel, fingerprint } from "./read-model";

describe("read model (ADR-0018 shape)", () => {
  it("one idea: stages, versions newest first, server vs locked, fingerprint and chain state", async () => {
    const w = fakeWorld();
    const root = newId();
    const r1 = await recordRow(w, { rootId: root, seq: 1, recordedAt: "2026-11-03T00:00:00Z", meta: META({ routine: [{ slot: "problem", estimated: true }] }) });
    const r2 = await recordRow(w, { rootId: root, seq: 2, recordedAt: "2026-11-10T00:00:00Z",
      meta: META({ milestone: "plan_decided", milestone_certain: true, decided: 2, deferred: 1, turn: "카드 연동 빼기", label: "개선 1", tags: [], files: [{ path: "결정-카드연동.md", size: 5, original: true }] }) });
    const s = syncOf({ roots: [rootRow(root, { visibility: "public" })], records: [r2, r1], anchors: [anchorRow(r1.record_id, { status: "confirmed", block_height: 870_000 })] });
    const { ideas, issues } = await buildModel(w.vault, s, verifyRows(w.userId, w.list, s, memoryStore()), new Map());
    expect(issues).toEqual([]);
    const idea = ideas[0];
    expect(idea.server).toEqual({ visibility: "public", firstAt: "2026-11-03T00:00:00Z", lastAt: "2026-11-10T00:00:00Z", versionCount: 2 });
    expect(idea.locked).toMatchObject({ title: "가계부 앱", tags: ["기획"], stagePreset: "build", stage: 3, paused: false });
    expect(idea.locked.stages[2]).toMatchObject({ no: 3, reached: true, estimated: false, decided: 2, deferred: 1, turn: "카드 연동 빼기", recordIds: [r2.record_id] });
    expect(idea.locked.stages[1]).toMatchObject({ reached: true, firstAt: null, decided: null, turn: null });
    expect(idea.locked.routine.find((r) => r.slot === "problem")).toEqual({ slot: "problem", filled: true, estimated: true, recordId: r1.record_id, at: "2026-11-03T00:00:00Z" });
    expect(idea.locked.routine.filter((r) => r.filled)).toHaveLength(1);
    expect(idea.versions.map((x) => x.recordId)).toEqual([r2.record_id, r1.record_id]);
    expect(idea.versions[1].server).toMatchObject({ fingerprint: fingerprint(r1.commitment), anchor: "server_confirmed", blockHeight: 870_000, deletedMark: false });
    expect(idea.versions[0].server.anchor).toBe("pending");
    expect(idea.versions[0].locked.mainFile).toBe("결정-카드연동.md");
    expect(idea.versions.map((x) => x.locked.label)).toEqual(["개선 1", null]); // F1 ①: version name for M5b
    expect(fingerprint("a3f00000000000000000000000000000000000000000000000000000000009c1")).toBe("a3f…9c1");
  });

  it("merged cells override what the records said", async () => {
    const w = fakeWorld();
    const root = newId();
    const r1 = await recordRow(w, { rootId: root, seq: 1 });
    const s = syncOf({ roots: [rootRow(root)], records: [r1] });
    const at = "2026-11-12T00:00:00Z";
    const merged: RootMetaV1 = { v: 1, version: 1, merged: {}, cells: {
      title: { value: "공정 가계부", at, engine: w.engine.id, seq: "2" },
      tags: { value: ["협의"], at, engine: w.engine.id, seq: "3" },
      [`r.${r1.record_id}.milestone`]: { value: { milestone: "plan_decided", certain: true }, at, engine: w.engine.id, seq: "4" },
      "routine.audience": { value: { estimated: false }, at, engine: w.engine.id, seq: "5" },
    } };
    const { ideas } = await buildModel(w.vault, s, verifyRows(w.userId, w.list, s, memoryStore()), new Map([[root, merged]]));
    expect(ideas[0].locked).toMatchObject({ title: "공정 가계부", tags: ["협의"], stage: 3 });
    expect(ideas[0].locked.routine.find((r) => r.slot === "audience")).toEqual({ slot: "audience", filled: true, estimated: false, recordId: null, at });
  });

  it("an unreadable record is reported and left out; ideas come oldest first", async () => {
    const w = fakeWorld();
    const older = newId();
    const newer = newId();
    const a = await recordRow(w, { rootId: newer, seq: 1, recordedAt: "2026-11-20T00:00:00Z" });
    const b = await recordRow(w, { rootId: older, seq: 2, recordedAt: "2026-11-05T00:00:00Z" });
    const lost = await recordRow(w, { rootId: older, seq: 3, recipient: newKemKeyPair().pub });
    const s = syncOf({ records: [a, b, lost] });
    const { ideas, issues } = await buildModel(w.vault, s, verifyRows(w.userId, w.list, s, memoryStore()), new Map());
    expect(issues).toEqual([{ kind: "unreadable", table: "records", id: lost.record_id }]);
    expect(ideas.map((i) => i.rootId)).toEqual([older, newer]);
    expect(ideas[0].server.versionCount).toBe(1);
    expect(ideas[0].server.visibility).toBe("private"); // no root row from the server: never shown as shareable
  });
});
