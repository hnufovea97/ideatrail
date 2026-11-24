import { describe, expect, it } from "vitest";
import { newId } from "@ideatrail/crypto/ids";
import { createApi, type Fetch } from "../api";
import { memoryStore } from "../engine-list";
import { refresh, type LoadDeps } from "../dashboard/load";
import { emptySync } from "../sync/store";
import { FakeServer } from "../testing/fake-server";
import { deltaRow, fakeWorld, recordRow, rootRow } from "../testing/fake-world";
import { routineShown, setRoutineShown } from "./prefs";

const noGithub: Fetch = async () => { throw new Error("GitHub must not be called"); };

describe("routine check turned off (설계 §3.1.4: 꺼 둔 동안에도 조용히 계속 채운다)", () => {
  it("still merges routine fragments; turning it back on shows the full history", async () => {
    const w = fakeWorld();
    const root = newId();
    const server = new FakeServer();
    server.add({ roots: [rootRow(root)], records: [await recordRow(w, { rootId: root, seq: 1 })],
      deltas: [await deltaRow(w, { rootId: root, seq: 2, body: { op: "routine", value: [{ slot: "feedback" }] } })] });
    const marks = memoryStore();
    setRoutineShown(marks, w.userId, false);
    const deps: LoadDeps = { api: createApi("http://fake.test", server.fetch), github: noGithub, marks, now: () => new Date(2026, 10, 24), alive: () => true };
    const out = await refresh(deps, w.vault, emptySync());
    expect(server.saves).toBe(1);
    expect(out.ideas[0].locked.routine.find((r) => r.slot === "feedback")?.filled).toBe(true);
    setRoutineShown(marks, w.userId, true);
    expect(routineShown(marks, w.userId)).toBe(true);
  });
});
