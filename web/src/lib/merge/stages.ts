// Stage names (ADR-0020): the AI names the five stages once (kind 4 op "stages" → cell `stages.ai`, the first one stays),
// the user may rename them any time (cell `stages`, saved straight into root_meta). The user's cell always wins;
// with neither, the build preset shows. Both are content, so they only ever travel sealed.
import type { RootMetaV1 } from "./lww";

export const STAGES_CELL = "stages";
export const AI_STAGES_CELL = "stages.ai";
export const STAGE_COUNT = 5;
export const STAGE_NAME_MAX = 12;

// ADR-0016 check (the same one the engine uses, record/aifields.go): Hangul, Latin, Han, ASCII digits, spaces and
// ?!~.,·-()/: only — no quotes, line breaks, control or bidi characters, no markup.
const PLAIN = /^[\p{Script=Hangul}\p{Script=Latin}\p{Script=Han}0-9 ?!~.,·\-()/:]+$/u;
const HAS_LETTER = /[\p{Script=Hangul}\p{Script=Latin}\p{Script=Han}0-9]/u;

/** One stage name: 1-12 characters, a plain line with no padding spaces. */
export const validStageName = (s: unknown): s is string =>
  typeof s === "string" && s === s.trim() && Array.from(s).length >= 1 && Array.from(s).length <= STAGE_NAME_MAX && PLAIN.test(s) && HAS_LETTER.test(s);

/** Exactly five good names, or null. Nothing is repaired: a wrong value is dropped whole. */
export function parseStageNames(v: unknown): readonly string[] | null {
  return Array.isArray(v) && v.length === STAGE_COUNT && v.every(validStageName) ? [...v] : null;
}

/** The idea's own names: the user's cell, else the AI's, else null (callers use the preset). */
export function stageNamesOf(meta: RootMetaV1): readonly string[] | null {
  return parseStageNames(meta.cells[STAGES_CELL]?.value) ?? parseStageNames(meta.cells[AI_STAGES_CELL]?.value);
}
