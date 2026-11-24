import { describe, expect, it } from "vitest";
import { toB64u, utf8 } from "@ideatrail/crypto/bytes";
import { newId } from "@ideatrail/crypto/ids";
import { randomKey } from "@ideatrail/crypto/keypair";
import { KIND, seal } from "@ideatrail/crypto/seal";
import { messageFor, sign } from "@ideatrail/crypto/sign";
import type { ApprovalRow } from "./api";
import { openApprovals } from "./approvals";
import { memoryStore } from "./engine-list";
import { seenMax, apprMark } from "./sync/marks";
import { fakeWorld, worldEngine, type World } from "./testing/fake-world";

const FOLDERS = [{ path: "/Users/e2e/Projects/가계부", name: "가계부 앱", files: 12 }];

async function row(w: World, o: { kind?: string; seed?: Uint8Array; engineId?: string; plain?: unknown; rootId?: string; seq?: bigint } = {}): Promise<ApprovalRow> {
  const approvalId = newId();
  const kind = o.kind ?? "add_folder";
  const summary = await seal(kind === "signup_select" ? KIND.folder_suggestions : KIND.approval_summary, w.ak.pub,
    { userId: w.userId, rootId: o.rootId ?? approvalId, version: "0" }, utf8(JSON.stringify(o.plain ?? { v: 1, folders: FOLDERS })));
  const apprSeq = o.seq ?? 1n;
  const engine_sig = sign(o.seed ?? w.engine.seed, messageFor({ type: "approval", userId: w.userId, approvalId, kind, summarySealed: summary, apprSeq }));
  return { approval_id: approvalId, engine_id: o.engineId ?? w.engine.id, kind, summary: toB64u(summary), appr_seq: apprSeq.toString(), engine_sig, created_at: "2026-11-24T00:00:00Z", expires_at: "2026-12-01T00:00:00Z" };
}

describe("openApprovals (5.9a)", () => {
  it("shows a signed request from a live engine with its folders", async () => {
    const w = fakeWorld();
    const r = await row(w);
    const out = await openApprovals([r], w.list, w.vault);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ approvalId: r.approval_id, engineId: w.engine.id, engineName: "Mac", kind: "add_folder", expiresAt: r.expires_at, folders: FOLDERS });
  });

  it("drops a wrong signature, an engine outside the list, a revoked engine, signup_select and unreadable summaries", async () => {
    const w = fakeWorld();
    const stranger = worldEngine("Other");
    const revoked = worldEngine("Old");
    const list = { ...w.list, engines: [...w.list.engines, { ...revoked.entry, revoked_at: "2026-11-20T00:00:00Z" }] };
    const rows = [
      await row(w, { seed: randomKey() }),
      await row(w, { seed: stranger.seed, engineId: stranger.id }),
      await row(w, { seed: revoked.seed, engineId: revoked.id }),
      await row(w, { kind: "signup_select" }),
      await row(w, { rootId: newId() }), // sealed to another approval id
      await row(w, { plain: { v: 2, folders: [] } }),
    ];
    expect(await openApprovals(rows, list, w.vault)).toEqual([]);
  });

  it("a summary changed after signing is dropped", async () => {
    const w = fakeWorld();
    const a = await row(w);
    const b = await row(w);
    expect(await openApprovals([{ ...a, summary: b.summary }], w.list, w.vault)).toEqual([]);
  });

  it("a disconnect request may have no folders", async () => {
    const w = fakeWorld();
    const out = await openApprovals([await row(w, { kind: "disconnect", plain: { v: 1, folders: [] } })], w.list, w.vault);
    expect(out[0]).toMatchObject({ kind: "disconnect", folders: [] });
  });

  it("keeps the highest appr_seq per engine: it only goes up, and no row is dropped for its number", async () => {
    const w = fakeWorld();
    const marks = memoryStore();
    const key = apprMark(w.userId, w.engine.id);
    const high = await row(w, { seq: 7n });
    const low = await row(w, { seq: 2n }); // a hole below the mark is normal: answered requests leave the list
    expect(await openApprovals([high], w.list, w.vault, marks)).toHaveLength(1);
    expect(seenMax(marks, key)).toBe(7n);
    expect(await openApprovals([low], w.list, w.vault, marks)).toHaveLength(1);
    expect(seenMax(marks, key)).toBe(7n);
    expect(await openApprovals([await row(w, { seq: 9n })], w.list, w.vault, marks)).toHaveLength(1);
    expect(seenMax(marks, key)).toBe(9n);
  });

  it("a number from an unsigned or foreign row never raises the mark", async () => {
    const w = fakeWorld();
    const marks = memoryStore();
    await openApprovals([await row(w, { seq: 50n, seed: randomKey() })], w.list, w.vault, marks);
    expect(seenMax(marks, apprMark(w.userId, w.engine.id))).toBe(0n);
  });
});
