import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateTokens, measure } from "./measure-tokens.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "measure-tokens.mjs");

function fixture(desc, skill) {
  const root = mkdtempSync(join(tmpdir(), "tokens-"));
  mkdirSync(join(root, "plugin", "skills", "record"), { recursive: true });
  writeFileSync(join(root, "plugin", "tools.json"), JSON.stringify([{ name: "t", description: desc, inputSchema: { type: "object" } }]));
  writeFileSync(join(root, "plugin", "skills", "record", "SKILL.md"), skill);
  return root;
}

test("estimate is an upper bound: ascii/3.5, non-ascii x1.5", () => {
  assert.equal(estimateTokens("abc"), 1);
  assert.equal(estimateTokens("abcd"), 2);
  assert.equal(estimateTokens("abcdefg"), 2);
  assert.equal(estimateTokens("가나"), 3);
});

test("measure sums tools and skill", () => {
  const r = measure({ toolsJson: JSON.stringify([{ name: "a", description: "x", inputSchema: {} }]), skillMd: "abc" });
  assert.equal(r.total, r.toolsTotal + r.skill);
  assert.ok(r.ok);
});

test("within budget exits 0", () => {
  const root = fixture("short", "short skill");
  assert.equal(spawnSync("node", [script, "--root", root]).status, 0);
});

test("skill over 600 exits 1", () => {
  const root = fixture("short", "a".repeat(2200));
  assert.equal(spawnSync("node", [script, "--root", root]).status, 1);
});

test("tools + skill over 1500 exits 1, and --json still prints", () => {
  const root = fixture("a".repeat(4000), "a".repeat(1400));
  const p = spawnSync("node", [script, "--json", "--root", root], { encoding: "utf8" });
  assert.equal(p.status, 1);
  assert.equal(JSON.parse(p.stdout).ok, false);
});
