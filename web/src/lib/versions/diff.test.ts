import { describe, expect, it } from "vitest";
import { lineDiff, MAX_DIFF_LINES } from "./diff";

describe("lineDiff (5.6)", () => {
  it("marks added, deleted and unchanged lines in reading order", () => {
    expect(lineDiff("가\n나\n다\n", "가\n다\n라\n")).toEqual([
      { op: "same", text: "가" }, { op: "del", text: "나" }, { op: "same", text: "다" }, { op: "add", text: "라" },
    ]);
  });
  it("identical texts are all same; empty before is all add", () => {
    expect(lineDiff("a\nb", "a\nb")?.every((l) => l.op === "same")).toBe(true);
    expect(lineDiff("", "a\nb")).toEqual([{ op: "add", text: "a" }, { op: "add", text: "b" }]);
  });
  it("a changed line is one delete and one add; CRLF and a final newline do not count", () => {
    expect(lineDiff("a\r\nb\r\n", "a\nc\n")).toEqual([{ op: "same", text: "a" }, { op: "del", text: "b" }, { op: "add", text: "c" }]);
  });
  it("gives up (null) when the differing middle is too long", () => {
    const many = (p: string) => Array.from({ length: MAX_DIFF_LINES + 1 }, (_, i) => `${p}${i}`).join("\n");
    expect(lineDiff(many("a"), many("b"))).toBeNull();
    expect(lineDiff(`${many("a")}\nsame`, `${many("a")}\nsame`)).not.toBeNull(); // shared lines are trimmed first
  });
});
