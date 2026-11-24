import { describe, expect, it } from "vitest";
import { version } from "../home/fixtures";
import type { VersionView } from "../model/read-model";
import type { Source } from "../versions/source";
import { journeyOf, type Step } from "./journey";

const at = (steps: readonly Step[], key: Step["key"]) => steps.find((s) => s.key === key)!;
const ready = (original: Extract<Source, { kind: "ready" }>["original"]): Source => ({ kind: "ready", original, diff: null });
const opened = (same: boolean): Source => ready({ kind: "opened", same, files: [], nonce: new Uint8Array(32), manifest: false });
const v = (anchor: VersionView["server"]["anchor"]) => version({ anchor });

describe("proof journey (5.8): five steps, each with its real state", () => {
  it("in order: 기록됨 → 지문 → 서버 서명 → GitHub → 블록체인", () => {
    expect(journeyOf(v("pending"), null).map((s) => s.key)).toEqual(["recorded", "fingerprint", "signed", "github", "chain"]);
  });
  it("what the browser already verified is done: the record, its fingerprint and the engine's signature", () => {
    const steps = journeyOf(v("pending"), null);
    expect(steps.slice(0, 3).map((s) => s.state)).toEqual(["done", "done", "done"]);
  });
  it("GitHub step follows where the original stands", () => {
    const g = (s: Source | null) => at(journeyOf(v("pending"), s), "github");
    expect(g(null)).toMatchObject({ state: "doing", note: "checking" });
    expect(g({ kind: "unlinked" })).toMatchObject({ state: "todo", note: "unlinked" });
    expect(g({ kind: "not_yet" })).toMatchObject({ state: "doing", note: "uploading" });
    expect(g({ kind: "failed" })).toMatchObject({ state: "warn", note: "failed" });
    expect(g(opened(true))).toMatchObject({ state: "done", note: null });
    expect(g(opened(false))).toMatchObject({ state: "warn", note: "changed" });
    expect(g(ready({ kind: "mismatch" }))).toMatchObject({ state: "warn", note: "different" });
    expect(g(ready({ kind: "unreadable" }))).toMatchObject({ state: "warn", note: "failed" });
    expect(g(ready({ kind: "no_original" }))).toMatchObject({ state: "done", note: "fingerprintOnly" });
  });
  it("the chain step is done only when this browser confirmed it; the server's word alone is 확인 중", () => {
    const c = (a: VersionView["server"]["anchor"]) => at(journeyOf(v(a), null), "chain");
    expect(c("confirmed")).toMatchObject({ state: "done", note: null });
    expect(c("server_confirmed")).toMatchObject({ state: "doing", note: "checking" });
    expect(c("pending")).toMatchObject({ state: "doing", note: "waiting" });
    expect(c("mismatch")).toMatchObject({ state: "warn", note: "mismatch" });
    expect(c("invalid")).toMatchObject({ state: "warn", note: "invalid" });
  });
});
