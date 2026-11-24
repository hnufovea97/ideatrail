// Stage names come from one table keyed by preset id (copy.ts STAGE_PRESETS). Components never hard-code them.
import { STAGE_PRESETS } from "../copy";
import type { StageNo } from "./stage";

export type StagePreset = keyof typeof STAGE_PRESETS;
export const DEFAULT_STAGE_PRESET: StagePreset = "build"; // the only preset in M5b; no switching UI yet
export const isStagePreset = (v: unknown): v is StagePreset => typeof v === "string" && Object.hasOwn(STAGE_PRESETS, v);

export const stageName = (no: StageNo, preset: StagePreset = DEFAULT_STAGE_PRESET): string => STAGE_PRESETS[preset][no - 1];
