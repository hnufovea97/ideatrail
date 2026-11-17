import { Hono } from "hono";
import { z } from "zod";
import { toB64u, toHex } from "@ideatrail/crypto/bytes";
import type { AppEnv, Bindings } from "../env";
import { ApiError } from "../http/errors";
import { browserWrite } from "../http/browser";
import { ipLimit, type Limiter } from "../http/rate-limit";
import { readJson, zB64u, zHex, zId, zSealed } from "../http/validate";
import { requireConfirmed } from "../auth/session";
import { requireStepup } from "../auth/stepup";
import { saveChallenge } from "../auth/challenges";
import { randomToken, sha256Hex } from "../auth/secrets";
import { runBatch } from "../db/change";
import { nowIso, toBytes } from "../db/values";

const ENVELOPE_KIND = 0x80;

const zPutRecovery = z.object({
  envelope_id: zId,
  method: z.literal("recovery"),
  wrapped_master_key: zSealed(ENVELOPE_KIND),
  lookup_hash: zHex(32),
  verify_pubkey: zB64u(32),
  label: zB64u().optional(),
});
const zLookup = z.object({ lookup_id: z.string().regex(/^[0-9a-f]{32}$/) });

const noRecovery = () => new ApiError(404, "recovery_not_found", "No account for this recovery key");

/** PUT /v1/envelopes — add or replace the one recovery envelope (session + step-up). */
export function envelopeRoutes() {
  const r = new Hono<AppEnv>();
  r.put("/", browserWrite, requireConfirmed, requireStepup, async (c) => {
    const body = await readJson(c, zPutRecovery);
    const userId = c.get("userId")!;
    const db = c.env.DB;
    const kdf = JSON.stringify({ v: 1, vk: toB64u(body.verify_pubkey) });
    await runBatch(db, [
      db.prepare("DELETE FROM key_envelopes WHERE user_id = ? AND method = 'recovery'").bind(userId),
      db.prepare("INSERT INTO key_envelopes (envelope_id, user_id, method, wrapped_master_key, kdf_params, lookup_hash, label, created_at) VALUES (?, ?, 'recovery', ?, ?, ?, ?, ?)")
        .bind(body.envelope_id, userId, body.wrapped_master_key, kdf, toHex(body.lookup_hash), body.label ?? null, nowIso()),
      db.prepare("UPDATE users SET recovery_key_status = 'created' WHERE user_id = ?").bind(userId),
    ]).catch((err: unknown) => {
      if (err instanceof Error && /UNIQUE|PRIMARY KEY/.test(err.message)) throw new ApiError(409, "envelope_conflict", "Generate a new recovery key and try again");
      throw err;
    });
    return c.json({ envelope_id: body.envelope_id });
  });
  return r;
}

/**
 * POST /v1/recovery/envelope — lookup_id → recovery envelope + a 5-minute challenge the caller must
 * sign with the RK-derived verify key before /v1/webauthn/register/options accepts it.
 */
export function recoveryRoutes(getLimiter: (env: Bindings) => Limiter) {
  const r = new Hono<AppEnv>();
  r.post("/envelope", browserWrite, ipLimit("recovery_envelope", getLimiter), async (c) => {
    const { lookup_id } = await readJson(c, zLookup);
    const env = await c.env.DB.prepare("SELECT envelope_id, user_id, wrapped_master_key FROM key_envelopes WHERE lookup_hash = ? AND method = 'recovery'")
      .bind(await sha256Hex(lookup_id)).first<{ envelope_id: string; user_id: string; wrapped_master_key: unknown }>();
    if (!env) throw noRecovery();
    const challenge = randomToken();
    const challengeId = await saveChallenge(c.env.DB, "recovery", challenge, { user_id: env.user_id, recovery_envelope_id: env.envelope_id });
    return c.json({
      user_id: env.user_id,
      envelope: { envelope_id: env.envelope_id, wrapped_master_key: toB64u(toBytes(env.wrapped_master_key)) },
      recovery_challenge_id: challengeId,
      challenge,
    });
  });
  return r;
}
