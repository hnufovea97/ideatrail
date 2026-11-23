import { describe, expect, it } from "vitest";
import type { Api, SyncResponse } from "../api";
import { MAX_PAGES, pull } from "./pull";
import { emptySync } from "./store";

const root = (id: string, change_seq: number, meta_version = 0) =>
  ({ root_id: id.repeat(26), visibility: "private", meta_version, list_meta: null, created_at: "2026-11-10T00:00:00Z", deleted_at: null, change_seq });

function pages(list: SyncResponse[]) {
  const seen: number[] = [];
  const api = { sync: async (cursor: number) => { seen.push(cursor); return list[seen.length - 1]; } } as unknown as Api;
  return { api, seen };
}

describe("pull /v1/sync to the end", () => {
  it("follows next_cursor and marks the state complete only at the end", async () => {
    const { api, seen } = pages([
      { changes: { roots: [root("a", 1)] }, cursor: 1, next_cursor: 1 },
      { changes: { roots: [root("b", 2)] }, cursor: 2, next_cursor: null },
    ]);
    const s = await pull(api, emptySync());
    expect(seen).toEqual([0, 1]);
    expect(s.complete).toBe(true);
    expect(s.cursor).toBe(2);
    expect([...s.roots.keys()]).toHaveLength(2);
  });
  it("a later change of the same row replaces it; an older one does not", async () => {
    const { api } = pages([
      { changes: { roots: [root("a", 5, 2)] }, cursor: 5, next_cursor: 5 },
      { changes: { roots: [root("a", 4, 1)] }, cursor: 6, next_cursor: null },
    ]);
    const s = await pull(api, emptySync());
    expect(s.roots.get("a".repeat(26))!.meta_version).toBe(2);
  });
  it("stops after MAX_PAGES and stays incomplete", async () => {
    const endless = { sync: async (c: number) => ({ changes: {}, cursor: c + 1, next_cursor: c + 1 }) } as unknown as Api;
    const s = await pull(endless, emptySync());
    expect(s.complete).toBe(false);
    expect(s.cursor).toBe(MAX_PAGES);
  });
  it("never moves the cursor backwards and keeps the old state untouched", async () => {
    const start = { ...emptySync(), cursor: 9 };
    const { api } = pages([{ changes: {}, cursor: 3, next_cursor: null }]);
    const s = await pull(api, start);
    expect(s.cursor).toBe(9);
    expect(start.complete).toBe(false);
  });
});
