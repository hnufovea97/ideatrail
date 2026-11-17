import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { newId } from "@ideatrail/crypto/ids";
import { signUp } from "./browser";
import { engineClient, seedEngine } from "./engine";
import { recordBody } from "./fixtures";

type Page = { changes: Record<string, { change_seq: number; record_id?: string; root_id?: string }[]>; cursor: number; next_cursor: number | null };
const page = async (b: Awaited<ReturnType<typeof signUp>>["b"], cursor: number, limit?: number) =>
  (await (await b.call("GET", `/v1/sync?cursor=${cursor}${limit ? `&limit=${limit}` : ""}`)).json()) as Page;
const count = (p: Page) => Object.values(p.changes).reduce((n, rows) => n + rows.length, 0);

async function account() {
  const s = await signUp();
  await s.b.call("POST", "/v1/account/confirm", {});
  const e = await seedEngine({ userId: s.userId });
  return { ...s, e, c: engineClient(e) };
}

describe("GET /v1/sync (2.9, 2.12)", () => {
  it("returns only rows after the cursor, never other accounts' rows (S2)", async () => {
    const a = await account();
    const other = await account();
    await other.c.post("/v1/records", recordBody({ log_seq: "1" }));
    const rec = recordBody({ log_seq: "1" });
    await a.c.post("/v1/records", rec);
    const p1 = await page(a.b, 0);
    expect(p1.changes.records.map((r) => r.record_id)).toEqual([rec.record_id]);
    expect(p1.changes.anchors).toHaveLength(1);
    expect(p1.changes.roots).toHaveLength(1);
    expect(p1.next_cursor).toBeNull();
    const p2 = await page(a.b, p1.cursor);
    expect(count(p2)).toBe(0);
  });

  it("201 records come in two pages with no gap or duplicate, and a write's rows are never split", async () => {
    const a = await account();
    const rootId = newId();
    for (let i = 1; i <= 67; i++) await a.c.post("/v1/records", recordBody({ log_seq: String(i), root_id: rootId })); // 1 root + 67×(record+anchor)
    const seen = new Set<string>();
    let cursor = 0;
    let pages = 0;
    for (;;) {
      const p = await page(a.b, cursor, 100);
      pages++;
      const recIds = p.changes.records.map((r) => r.record_id!);
      const anchorIds = p.changes.anchors.map((r) => r.record_id!);
      expect(anchorIds.sort()).toEqual([...recIds].sort()); // record and its anchor share a change_seq → same page
      for (const id of recIds) { expect(seen.has(id)).toBe(false); seen.add(id); }
      if (p.next_cursor === null) break;
      cursor = p.next_cursor;
    }
    expect(seen.size).toBe(67);
    expect(pages).toBe(2);
  });

  it("bad cursor or limit → 400", async () => {
    const a = await account();
    expect((await a.b.call("GET", "/v1/sync?cursor=-1")).status).toBe(400);
    expect((await a.b.call("GET", "/v1/sync?limit=201")).status).toBe(400);
  });

  it("engine rows expose only public keys and state", async () => {
    const a = await account();
    const p = await page(a.b, 0);
    expect(p.changes.engines).toHaveLength(0); // seeded with change_seq 0
    await env.DB.prepare("UPDATE engines SET change_seq = 1 WHERE engine_id = ?").bind(a.e.engineId).run();
    const q = await page(a.b, 0);
    expect(Object.keys(q.changes.engines[0]).sort()).toEqual(["change_seq", "created_at", "engine_id", "kem_pubkey", "pause_reason", "paused", "revoked_at", "sign_pubkey"]);
  });
});
