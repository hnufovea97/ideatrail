import { Hono } from "hono";
import { z } from "zod";
import { toB64u } from "@ideatrail/crypto/bytes";
import type { AppEnv } from "../env";
import { ApiError } from "../http/errors";
import { browserWrite } from "../http/browser";
import { readJson, zB64u, zId, zSealedMax, zSeq } from "../http/validate";
import { requireEngine } from "../auth/engine-sig";
import { requireConfirmed } from "../auth/session";
import { requireStepup } from "../auth/stepup";
import { CURSOR_SQL, guard, runBatch, writeWithCursor } from "../db/change";
import { checkEngineQuota, countEngineWrite } from "../db/quota";
import { inSeconds, nowIso, toBytes } from "../db/values";
import { idConflict, isConstraintError, requireEngineAccount } from "./engine-common";
import { userWriteLimit, type Limiter } from "../http/rate-limit";
import type { Bindings } from "../env";

export const APPROVAL_DAYS = 7;
export const MAX_PENDING_APPROVALS = 20;
export const MAX_INBOX = 100;
const KIND_APPROVAL_SUMMARY = 10;
const KIND_FOLDER_SUGGESTIONS = 11;
const KIND_ENGINE_INBOX = 7;
const MAX_SEALED = 16 * 1024;

const zApproval = z.object({
  approval_id: zId,
  kind: z.enum(["import", "add_folder", "forget_original", "disconnect", "signup_select", "update"]),
  summary: zB64u(),
  appr_seq: zSeq,
  engine_sig: zB64u(64),
}).superRefine((v, ctx) => {
  const kind = v.kind === "signup_select" ? KIND_FOLDER_SUGGESTIONS : KIND_APPROVAL_SUMMARY;
  const s = v.summary;
  if (s.length > MAX_SEALED || s.length < 5 || s[0] !== 0x49 || s[1] !== 0x54 || s[2] !== 0x31 || s[3] !== kind) ctx.addIssue({ code: "custom", path: ["summary"], message: "bad sealed blob" });
});

const zMessage = z.object({ msg_id: zId, sealed: zSealedMax(KIND_ENGINE_INBOX, MAX_SEALED) });
const zDecide = z.object({ decision: z.enum(["approved", "rejected"]), message: zMessage });
const zInboxPost = z.object({ engine_id: zId, msg_id: zId, sealed: zSealedMax(KIND_ENGINE_INBOX, MAX_SEALED) });

const notFound = () => new ApiError(404, "not_found", "Not found");

export function approvalRoutes(getLimiter: (env: Bindings) => Limiter) {
  const r = new Hono<AppEnv>();

  /** Engine asks the user to approve something (spec §2 appr_seq, kind 10/11 summary). */
  r.post("/", requireEngine, requireEngineAccount, async (c) => {
    const b = await readJson(c, zApproval);
    const db = c.env.DB;
    const userId = c.get("userId")!;
    const engineId = c.get("engineId")!;
    const same = async () => {
      const row = await db.prepare("SELECT engine_id, CAST(engine_seq AS TEXT) AS seq, kind, summary, engine_sig FROM pending_approvals WHERE approval_id = ? AND user_id = ?")
        .bind(b.approval_id, userId).first<{ engine_id: string; seq: string; kind: string; summary: unknown; engine_sig: string }>();
      if (!row) return false;
      const stored = toBytes(row.summary);
      return row.engine_id === engineId && row.seq === b.appr_seq && row.kind === b.kind && row.engine_sig === toB64u(b.engine_sig)
        && stored.length === b.summary.length && stored.every((x, i) => x === b.summary[i]);
    };
    if (await same()) return c.json({ approval_id: b.approval_id, duplicate: true });
    const open = await db.prepare("SELECT COUNT(*) AS n FROM pending_approvals WHERE engine_id = ? AND status = 'pending' AND expires_at > ?")
      .bind(engineId, nowIso()).first<number>("n");
    if ((open ?? 0) >= MAX_PENDING_APPROVALS) throw new ApiError(429, "too_many_approvals", "Answer the waiting requests first");
    await checkEngineQuota(db, engineId, userId);
    try {
      await writeWithCursor(db, userId, [
        ...countEngineWrite(db, engineId),
        // engine liveness and the 20-waiting cap are part of the INSERT itself (no race past the pre-check)
        db.prepare(`INSERT INTO pending_approvals (approval_id, user_id, engine_id, kind, summary, engine_seq, engine_sig, created_at, expires_at, change_seq)
                    SELECT ?1, ?2, engine_id, ?3, ?4, CAST(?5 AS INTEGER), ?6, ?7, ?8, ${CURSOR_SQL.replace("?", "?2")}
                    FROM engines WHERE engine_id = ?9 AND user_id = ?2 AND revoked_at IS NULL
                      AND (SELECT COUNT(*) FROM pending_approvals WHERE engine_id = ?9 AND status = 'pending' AND expires_at > ?7) < ?10`)
          .bind(b.approval_id, userId, b.kind, b.summary, b.appr_seq, toB64u(b.engine_sig), nowIso(), inSeconds(APPROVAL_DAYS * 86400), engineId, MAX_PENDING_APPROVALS),
        guard(db),
      ], new ApiError(429, "too_many_approvals", "Answer the waiting requests first"));
    } catch (err) {
      if (!isConstraintError(err)) throw err;
      if (await same()) return c.json({ approval_id: b.approval_id, duplicate: true });
      throw idConflict();
    }
    return c.json({ approval_id: b.approval_id }, 201);
  });

  /** Waiting approvals for the signed-in account (signup step 5 reads signup_select here). */
  r.get("/", requireConfirmed, async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT approval_id, engine_id, kind, summary, CAST(engine_seq AS TEXT) AS appr_seq, engine_sig, created_at, expires_at
         FROM pending_approvals WHERE user_id = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at`,
    ).bind(c.get("userId"), nowIso()).all<Record<string, unknown>>();
    return c.json({ approvals: results.map((a) => ({ ...a, summary: toB64u(toBytes(a.summary)) })) });
  });

  /** Approve or reject (step-up), and hand the engine its sealed answer in the same batch. */
  r.post("/:id/decide", browserWrite, requireConfirmed, userWriteLimit(getLimiter), requireStepup, async (c) => {
    const b = await readJson(c, zDecide);
    const db = c.env.DB;
    const userId = c.get("userId")!;
    const id = c.req.param("id");
    const now = nowIso();
    try {
      await writeWithCursor(db, userId, [
        db.prepare(`UPDATE pending_approvals SET status = ?, decided_at = ?, change_seq = ${CURSOR_SQL}
                    WHERE approval_id = ? AND user_id = ? AND status = 'pending' AND expires_at > ?`).bind(b.decision, now, userId, id, userId, now),
        guard(db),
        db.prepare(`INSERT INTO engine_inbox (msg_id, user_id, engine_id, sealed, created_at)
                    SELECT ?, ?, e.engine_id, ?, ? FROM pending_approvals a JOIN engines e ON e.engine_id = a.engine_id
                    WHERE a.approval_id = ? AND a.user_id = ? AND e.user_id = ? AND e.revoked_at IS NULL`)
          .bind(b.message.msg_id, userId, b.message.sealed, now, id, userId, userId),
        guard(db),
      ], new ApiError(409, "approval_closed", "Already answered, expired, or the engine was disconnected"));
    } catch (err) {
      if (isConstraintError(err)) throw idConflict();
      throw err;
    }
    return c.json({ approval_id: id, status: b.decision });
  });

  return r;
}

export function inboxRoutes(getLimiter: (env: Bindings) => Limiter) {
  const r = new Hono<AppEnv>();

  /** Browser → engine message (HPKE Auth, kind 7) for one of this account's live engines. */
  r.post("/", browserWrite, requireConfirmed, userWriteLimit(getLimiter), async (c) => {
    const b = await readJson(c, zInboxPost);
    const db = c.env.DB;
    const userId = c.get("userId")!;
    const queued = await db.prepare("SELECT COUNT(*) AS n FROM engine_inbox WHERE engine_id = ? AND user_id = ?").bind(b.engine_id, userId).first<number>("n");
    if ((queued ?? 0) >= MAX_INBOX) throw new ApiError(429, "inbox_full", "The engine has not picked up its messages yet");
    try {
      await runBatch(db, [
        db.prepare(`INSERT INTO engine_inbox (msg_id, user_id, engine_id, sealed, created_at)
                    SELECT ?, ?, engine_id, ?, ? FROM engines WHERE engine_id = ? AND user_id = ? AND revoked_at IS NULL
                      AND (SELECT COUNT(*) FROM engine_inbox WHERE engine_id = ?) < ?`)
          .bind(b.msg_id, userId, b.sealed, nowIso(), b.engine_id, userId, b.engine_id, MAX_INBOX),
        guard(db),
      ], notFound());
    } catch (err) {
      if (isConstraintError(err)) throw idConflict();
      throw err;
    }
    return c.json({ msg_id: b.msg_id }, 201);
  });

  r.get("/", requireEngine, async (c) => {
    const { results } = await c.env.DB.prepare("SELECT msg_id, sealed, created_at FROM engine_inbox WHERE engine_id = ? ORDER BY created_at, msg_id LIMIT ?")
      .bind(c.get("engineId"), MAX_INBOX).all<{ msg_id: string; sealed: unknown; created_at: string }>();
    return c.json({ messages: results.map((m) => ({ ...m, sealed: toB64u(toBytes(m.sealed)) })) });
  });

  r.delete("/:id", requireEngine, async (c) => {
    const res = await c.env.DB.prepare("DELETE FROM engine_inbox WHERE msg_id = ? AND engine_id = ?").bind(c.req.param("id"), c.get("engineId")).run();
    if (res.meta.changes !== 1) throw notFound();
    return c.json({ deleted: true });
  });

  return r;
}
