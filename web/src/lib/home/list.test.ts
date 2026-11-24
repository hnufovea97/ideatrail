import { describe, expect, it } from "vitest";
import { idea, version } from "./fixtures";
import { DEFAULT_SORT, ideaChain, listIdeas, matchesQuery, type ListQuery } from "./list";

const q = (over: Partial<ListQuery> = {}): ListQuery => ({ tab: "all", query: "", sort: DEFAULT_SORT, opened: new Map(), ...over });
const titles = (xs: { locked: { title: string } }[]) => xs.map((x) => x.locked.title);

const budget = idea({ title: "공정 가계부 앱", tags: ["기획", "협의"], stage: 5, visibility: "private", firstAt: "2026-09-03T00:00:00Z", lastAt: "2026-11-02T00:00:00Z" });
const swap = idea({ title: "동네 중고 교환", tags: ["아이디어"], stage: 4, visibility: "public", firstAt: "2026-09-20T00:00:00Z", lastAt: "2026-10-28T00:00:00Z" });
const piano = idea({ title: "피아노 연습 기록기", tags: ["아이디어"], stage: 1, visibility: "private", firstAt: "2026-11-13T00:00:00Z", lastAt: "2026-11-13T00:00:00Z" });
const all = [piano, swap, budget];

describe("home list", () => {
  it("defaults to 처음 기록한 순 (oldest first)", () => {
    expect(DEFAULT_SORT).toBe("firstOld");
    expect(titles(listIdeas(all, q()))).toEqual(["공정 가계부 앱", "동네 중고 교환", "피아노 연습 기록기"]);
  });
  it("sorts by newest first record, last record, stage and this device's opening order", () => {
    expect(titles(listIdeas(all, q({ sort: "firstNew" })))).toEqual(["피아노 연습 기록기", "동네 중고 교환", "공정 가계부 앱"]);
    expect(titles(listIdeas(all, q({ sort: "last" })))).toEqual(["피아노 연습 기록기", "공정 가계부 앱", "동네 중고 교환"]);
    expect(titles(listIdeas(all, q({ sort: "stage" })))).toEqual(["공정 가계부 앱", "동네 중고 교환", "피아노 연습 기록기"]);
    const opened = new Map([[swap.rootId, 200], [piano.rootId, 100]]);
    expect(titles(listIdeas(all, q({ sort: "opened", opened })))).toEqual(["동네 중고 교환", "피아노 연습 기록기", "공정 가계부 앱"]);
  });
  it("tabs split 공유 가능 (public) from 나만 보기 (private)", () => {
    expect(titles(listIdeas(all, q({ tab: "shared" })))).toEqual(["동네 중고 교환"]);
    expect(titles(listIdeas(all, q({ tab: "mine" })))).toEqual(["공정 가계부 앱", "피아노 연습 기록기"]);
  });
  it("searches #tags by prefix and other words in the name or stage name", () => {
    expect(matchesQuery(budget, "#기획 MVP 완료")).toBe(true);
    expect(matchesQuery(budget, "#기")).toBe(true);
    expect(matchesQuery(swap, "#기획")).toBe(false);
    expect(titles(listIdeas(all, q({ query: "#아이디어 개발 중" })))).toEqual(["동네 중고 교환"]);
    expect(titles(listIdeas(all, q({ query: "가계부" })))).toEqual(["공정 가계부 앱"]);
    expect(listIdeas(all, q({ query: "   " }))).toHaveLength(3);
  });
  it("never reorders the input", () => {
    const before = all.map((i) => i.rootId);
    listIdeas(all, q({ sort: "stage" }));
    expect(all.map((i) => i.rootId)).toEqual(before);
  });
  it("shows the card badge as done only when every version is in a block", () => {
    expect(ideaChain(idea({ versions: [version({ anchor: "server_confirmed" }), version({ anchor: "server_confirmed" })] }))).toBe("done");
    expect(ideaChain(idea({ versions: [version({ anchor: "pending" }), version({ anchor: "server_confirmed" })] }))).toBe("pending");
  });
});
