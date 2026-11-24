import { describe, expect, it } from "vitest";
import { STAGE_PRESETS } from "../copy";
import { DEFAULT_STAGE_PRESET, isStagePreset, stageName } from "./stage-names";

describe("stage names by preset", () => {
  it("has only the build preset for now, five names each", () => {
    expect(Object.keys(STAGE_PRESETS)).toEqual(["build"]);
    expect(DEFAULT_STAGE_PRESET).toBe("build");
    for (const names of Object.values(STAGE_PRESETS)) expect(names).toHaveLength(5);
  });
  it("names a stage number from the preset", () => {
    expect([1, 2, 3, 4, 5].map((n) => stageName(n as 1 | 2 | 3 | 4 | 5))).toEqual(["착상", "기획 중", "기획 확정", "개발 중", "MVP 완료"]);
    expect(isStagePreset("build")).toBe(true);
    expect(isStagePreset("toString")).toBe(false); // own keys only
  });
});
