import { describe, expect, it } from "vitest";
import { idea, stage, version } from "./fixtures";
import { chainOf, lifeOf } from "./life";

const SEOUL = "Asia/Seoul";

describe("idea life", () => {
  const v1 = version({ recordId: "01jcm3v8q7s2kx4f9d6b5n0ta1", at: "2026-11-03T00:00:00Z", label: null, anchor: "server_confirmed", file: "아이디어-메모.md" });
  const v2 = version({ recordId: "01jcm3v8q7s2kx4f9d6b5n0ta2", at: "2026-11-10T00:00:00Z", label: "초안", anchor: "confirmed" });
  const v3 = version({ recordId: "01jcm3v8q7s2kx4f9d6b5n0ta3", at: "2026-11-18T00:00:00Z", label: "개선 1", anchor: "pending", file: "결정-카드연동.md" });
  const subject = idea({
    stage: 3, versions: [v3, v2, v1],
    stages: [
      stage(1, { reached: true, firstAt: v1.server.recordedAt, lastAt: v1.server.recordedAt, recordIds: [v1.recordId] }),
      stage(2, { reached: true, estimated: true }),
      stage(3, { reached: true, firstAt: v2.server.recordedAt, lastAt: v3.server.recordedAt, recordIds: [v2.recordId, v3.recordId], decided: 2, deferred: 1, turn: "카드 연동 빼기" }),
      stage(4), stage(5),
    ],
  });

  it("gives each stage its name, first date, range and versions newest first", () => {
    const life = lifeOf(subject, SEOUL);
    expect(life.stages.map((s) => [s.name, s.reached, s.current, s.date])).toEqual([
      ["착상", true, false, "11.03"], ["기획 중", true, false, null], ["기획 확정", true, true, "11.10"], ["개발 중", false, false, null], ["MVP 완료", false, false, null]]);
    const s3 = life.stages[2];
    expect(s3.range).toBe("11.10 – 11.18");
    expect(s3.versions.map((v) => [v.when, v.name, v.file, v.fingerprint, v.chain])).toEqual([
      ["11.18", "개선 1", "결정-카드연동.md", "a3f…9c1", "pending"], ["11.10", "초안", "docs/plan.md", "a3f…9c1", "done"]]);
    expect(life.stages[1].estimated).toBe(true);
  });
  it("shows 확산됨 only for a browser-checked block; the server's word alone is 확인 중", () => {
    expect(chainOf(version({ anchor: "confirmed" }))).toBe("done");
    expect(chainOf(version({ anchor: "server_confirmed" }))).toBe("checking");
    expect(chainOf(version({ anchor: "pending" }))).toBe("pending");
    expect(chainOf(version({ anchor: "mismatch" }))).toBe("mismatch");
    expect(chainOf(version({ anchor: "invalid" }))).toBe("invalid");
  });
  it("keeps 결정·미룸 per stage, sums them for the idea, and the turn stays in its stage", () => {
    const life = lifeOf(subject, SEOUL);
    expect([life.stages[2].decided, life.stages[2].deferred, life.stages[2].turn]).toEqual([2, 1, "카드 연동 빼기"]);
    expect([life.stages[0].decided, life.stages[0].turn]).toEqual([null, null]);
    expect([life.decided, life.deferred]).toEqual([2, 1]);
  });
  it("names a version without a label by its place from the first record (records from before ADR-0019)", () => {
    expect(lifeOf(subject, SEOUL).stages[0].versions[0].name).toBe("기록 1");
  });
  it("hides counts entirely when no record has them", () => {
    const old = lifeOf(idea({ stages: [stage(1, { reached: true })] }), SEOUL);
    expect([old.decided, old.deferred]).toEqual([null, null]);
  });

  it("uses the idea's own stage names (ADR-0020) and the preset when it has none", () => {
    const own = idea({ stage: 3, stages: subject.locked.stages as never, stageNames: ["착상", "개요", "초고", "퇴고", "발행"] });
    expect(lifeOf(own, SEOUL).stages.map((s) => s.name)).toEqual(["착상", "개요", "초고", "퇴고", "발행"]);
  });
});
