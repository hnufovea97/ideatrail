import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { ApiError } from "../http/errors";
import { browserWrite } from "../http/browser";
import { readJson, zId, zSealedMax } from "../http/validate";
import { requireConfirmed, requireSession } from "../auth/session";
import { requireStepup } from "../auth/stepup";
import { CURSOR_SQL, guard, writeWithCursor } from "../db/change";
import { nowIso } from "../db/values";
import { MAX_OPEN_DELTAS } from "./deltas";
import { userWriteLimit, type Limiter } from "../http/rate-limit";
import type { Bindings } from "../env";

const RELOCK = { root_meta: 0x82, prefs: 0x83, recall_notes: 0x84, reminder_state: 0x85 } as const;
const MAX_META = 16 * 1024;

const notFound = () => new ApiError(404, "root_not_found", "No such root");

const zMeta = z.object({
  list_meta: zSealedMax(RELOCK.root_meta, MAX_META),
  meta_version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  merged_delta_ids: z.array(zId).max(MAX_OPEN_DELTAS).refine((ids) => new Set(ids).size === ids.length, "duplicate ids"),
});

/** POST /v1/roots/:id/meta — the browser's merged list info replaces the deltas it folded in. */
export function rootRoutes(getLimiter: (env: Bindings) => Limiter) {
  const r = new Hono<AppEnv>();
  r.post("/:id/meta", browserWrite, requireConfirmed, userWriteLimit(getLimiter), async (c) => {
    const b = await readJson(c, zMeta);
    const db = c.env.DB;
    const userId = c.get("userId")!;
    const rootId = c.req.param("id");
    const root = await db.prepare("SELECT meta_version FROM roots WHERE root_id = ? AND user_id = ? AND deleted_at IS NULL").bind(rootId, userId).first<number>("meta_version");
    if (root === null) throw notFound();
    if (root !== b.meta_version) throw new ApiError(409, "meta_version_conflict", "Merged on another device; reload and merge again");
    const now = nowIso();
    await writeWithCursor(db, userId, [
      db.prepare(`UPDATE roots SET list_meta = ?, meta_version = meta_version + 1, change_seq = ${CURSOR_SQL}
                  WHERE root_id = ? AND user_id = ? AND meta_version = ? AND deleted_at IS NULL`).bind(b.list_meta, userId, rootId, userId, b.meta_version),
      guard(db),
      // one bound JSON array instead of up to 500 parameters (D1 caps bindings at 100)
      db.prepare(`UPDATE meta_deltas SET merged_at = ?, change_seq = ${CURSOR_SQL}
                  WHERE user_id = ? AND root_id = ? AND merged_at IS NULL AND delta_id IN (SELECT value FROM json_each(?))`)
        .bind(now, userId, userId, rootId, JSON.stringify(b.merged_delta_ids)),
      db.prepare("SELECT CASE WHEN changes() <> ? THEN json('guard_failed') END").bind(b.merged_delta_ids.length),
    ], new ApiError(409, "meta_version_conflict", "Merged on another device; reload and merge again"));
    return c.json({ meta_version: b.meta_version + 1 });
  });
  return r;
}

const zVisibility = z.object({ root_id: zId, visibility: z.enum(["private", "public"]), public_label: z.string().max(80).optional() });

/** POST /v1/visibility — public/private switch (step-up). Public pages themselves arrive in M7. */
export function visibilityRoutes(getLimiter: (env: Bindings) => Limiter) {
  const r = new Hono<AppEnv>();
  r.post("/", browserWrite, requireConfirmed, userWriteLimit(getLimiter), requireStepup, async (c) => {
    const b = await readJson(c, zVisibility);
    const userId = c.get("userId")!;
    await writeWithCursor(c.env.DB, userId, [
      c.env.DB.prepare(`UPDATE roots SET visibility = ?, public_label = ?, change_seq = ${CURSOR_SQL} WHERE root_id = ? AND user_id = ? AND deleted_at IS NULL`)
        .bind(b.visibility, b.visibility === "public" ? (b.public_label ?? null) : null, userId, b.root_id, userId),
      guard(c.env.DB),
    ], notFound());
    return c.json({ root_id: b.root_id, visibility: b.visibility });
  });
  return r;
}

const zPrefs = z.object({
  view_prefs: zSealedMax(RELOCK.prefs, MAX_META).optional(),
  recall_notes: zSealedMax(RELOCK.recall_notes, MAX_META).optional(),
  reminder_state: zSealedMax(RELOCK.reminder_state, MAX_META).optional(),
}).refine((v) => v.view_prefs || v.recall_notes || v.reminder_state, "nothing to save");

/** PUT /v1/prefs — relocked view settings, recall notes, reminder state (any subset). */
export function prefsRoutes(getLimiter: (env: Bindings) => Limiter) {
  const r = new Hono<AppEnv>();
  r.put("/", browserWrite, requireConfirmed, userWriteLimit(getLimiter), async (c) => {
    const b = await readJson(c, zPrefs);
    await c.env.DB.prepare(
      "UPDATE users SET view_prefs = COALESCE(?, view_prefs), recall_notes = COALESCE(?, recall_notes), reminder_state = COALESCE(?, reminder_state) WHERE user_id = ?",
    ).bind(b.view_prefs ?? null, b.recall_notes ?? null, b.reminder_state ?? null, c.get("userId")).run();
    return c.json({ saved: true });
  });
  return r;
}

const EVENT_KINDS = ["signup", "connector_linked", "dashboard_opened", "first_confirmed", "bulk_first_done", "device_added"] as const;

/** POST /v1/events — content-free usage events, at most one per kind per account per day. */
export function eventRoutes(getLimiter: (env: Bindings) => Limiter) {
  const r = new Hono<AppEnv>();
  r.post("/", browserWrite, requireSession, userWriteLimit(getLimiter), async (c) => {
    const { kind } = await readJson(c, z.object({ kind: z.enum(EVENT_KINDS) }));
    const userId = c.get("userId")!;
    const now = nowIso();
    await c.env.DB.prepare("INSERT OR IGNORE INTO usage_events (event_id, user_id, kind, at) VALUES (?, ?, ?, ?)")
      .bind(`${userId}:${kind}:${now.slice(0, 10)}`, userId, kind, now).run();
    return c.json({ recorded: true });
  });
  return r;
}
