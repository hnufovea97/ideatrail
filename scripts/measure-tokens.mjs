#!/usr/bin/env node
// Token budget check for the ideatrail plugin (design doc 3.1.5): MCP tool list + record skill <= 1,500
// tokens, skill alone <= 600.
//
// Method (a deliberately CONSERVATIVE upper bound, no tokenizer dependency):
//   tokens = ceil(ascii_chars / 3.5) + ceil(non_ascii_chars * 1.5)
// English text runs about 4 characters per token, so /3.5 overestimates (checked 2026-11-25: Claude Code's
// own `claude --plugin-dir plugin plugin details ideatrail` counts the skill at ~450, this script higher); Korean runs about 1 token per
// syllable or less, so 1.5 overestimates. Tools are measured as minified JSON (name, description,
// inputSchema) of plugin/tools.json, which engine/internal/mcpserver/tools_golden_test.go keeps equal to
// what the server advertises. The skill is measured as the whole SKILL.md file.
//
// Usage: node scripts/measure-tokens.mjs [--json] [--root <repo root>]
// Exit code 1 when tools + skill > 1500 or skill > 600.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const BUDGET_TOTAL = 1500;
export const BUDGET_SKILL = 600;

export function estimateTokens(text) {
  let ascii = 0;
  let other = 0;
  for (const ch of text) {
    if (ch.codePointAt(0) < 128) ascii += 1;
    else other += 1;
  }
  return Math.ceil(ascii / 3.5) + Math.ceil(other * 1.5);
}

export function measure({ toolsJson, skillMd }) {
  const tools = JSON.parse(toolsJson).map((t) => ({
    name: t.name,
    tokens: estimateTokens(JSON.stringify({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));
  const toolsTotal = tools.reduce((n, t) => n + t.tokens, 0);
  const skill = estimateTokens(skillMd);
  const total = toolsTotal + skill;
  const problems = [];
  if (total > BUDGET_TOTAL) problems.push(`tools + skill ${total} > ${BUDGET_TOTAL}`);
  if (skill > BUDGET_SKILL) problems.push(`skill ${skill} > ${BUDGET_SKILL}`);
  return { tools, toolsTotal, skill, total, budget: { total: BUDGET_TOTAL, skill: BUDGET_SKILL }, ok: problems.length === 0, problems };
}

export function table(r) {
  const rows = [...r.tools.map((t) => [`tool ${t.name}`, t.tokens]), ["tools subtotal", r.toolsTotal], ["skill (record)", r.skill], ["total", r.total]];
  const lines = ["| 항목 | 토큰(상한 추정) |", "|---|---:|", ...rows.map(([k, v]) => `| ${k} | ${v} |`)];
  lines.push(`| 예산 | 합계 ${r.budget.total} · 스킬 ${r.budget.skill} |`);
  return lines.join("\n");
}

function main(argv) {
  const rootIdx = argv.indexOf("--root");
  const root = rootIdx >= 0 ? resolve(argv[rootIdx + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const r = measure({
    toolsJson: readFileSync(join(root, "plugin", "tools.json"), "utf8"),
    skillMd: readFileSync(join(root, "plugin", "skills", "record", "SKILL.md"), "utf8"),
  });
  console.log(argv.includes("--json") ? JSON.stringify(r, null, 2) : table(r));
  if (!r.ok) {
    console.error(`budget exceeded: ${r.problems.join("; ")}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
