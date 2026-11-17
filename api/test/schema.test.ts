import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { newId } from "@ideatrail/crypto/ids";
import { CURSOR_SQL, guard, runBatch, writeWithCursor } from "../src/db/change";
import { toBytes } from "../src/db/values";
import { seedUser } from "./helpers";

const TABLES = ["users", "passkey_credentials", "key_envelopes", "webauthn_challenges", "sessions", "engines", "connectors",
  "roots", "records", "meta_deltas", "anchors", "storage_links", "audit_log", "public_shares", "usage_events",
  "pairing_sessions", "device_add_sessions", "pending_approvals", "engine_inbox", "repo_heads", "import_allowances"].sort();

const insertRoot = (rootId: string, userId: string) =>
  env.DB.prepare(`INSERT INTO roots (root_id, user_id, created_at, change_seq) VALUES (?, ?, 't', ${CURSOR_SQL})`).bind(rootId, userId, userId);

describe("schema (2.2)", () => {
  it("has exactly the 21 tables", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY name",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual(TABLES);
  });

  it("enforces foreign keys", async () => {
    await expect(env.DB.prepare("INSERT INTO sessions VALUES ('s', 'no-such-user', 't', 't')").run()).rejects.toThrow(/FOREIGN KEY/);
  });

  it("each write bumps the account cursor once and stamps rows with it", async () => {
    const u = await seedUser();
    const [r1, r2] = [newId(), newId()];
    await writeWithCursor(env.DB, u, [insertRoot(r1, u)]);
    await writeWithCursor(env.DB, u, [insertRoot(r2, u)]);
    const { results } = await env.DB.prepare("SELECT root_id, change_seq FROM roots WHERE user_id = ? ORDER BY change_seq").bind(u).all();
    expect(results).toEqual([{ root_id: r1, change_seq: 1 }, { root_id: r2, change_seq: 2 }]);
    expect(await env.DB.prepare("SELECT change_seq FROM users WHERE user_id = ?").bind(u).first("change_seq")).toBe(2);
  });

  it("a failing statement rolls back the cursor bump", async () => {
    const u = await seedUser();
    await expect(writeWithCursor(env.DB, u, [insertRoot(newId(), newId())])).rejects.toThrow();
    expect(await env.DB.prepare("SELECT change_seq FROM users WHERE user_id = ?").bind(u).first("change_seq")).toBe(0);
  });

  it("an unknown user trips the bump guard (409) and writes nothing", async () => {
    const ghost = newId();
    await expect(writeWithCursor(env.DB, ghost, [insertRoot(newId(), ghost)])).rejects.toMatchObject({ status: 409 });
  });

  it("guard after a no-op conditional UPDATE rolls back the whole batch", async () => {
    const u = await seedUser();
    const r = newId();
    await expect(runBatch(env.DB, [
      insertRoot(r, u),
      env.DB.prepare("UPDATE users SET engine_list_version = 1 WHERE user_id = ? AND engine_list_version = 99").bind(u),
      guard(env.DB),
    ])).rejects.toMatchObject({ status: 409, code: "conflict" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM roots WHERE root_id = ?").bind(r).first("n")).toBe(0);
  });

  it("BLOBs come back as bytes via toBytes", async () => {
    const u = await seedUser();
    const raw = await env.DB.prepare("SELECT wrapped_account_privkey FROM users WHERE user_id = ?").bind(u).first("wrapped_account_privkey");
    expect(toBytes(raw)).toEqual(new Uint8Array([0x49, 0x54, 0x31, 0x81]));
  });
});
