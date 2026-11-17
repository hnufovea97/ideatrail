import { Hono } from "hono";
import { z } from "zod";
import { fromB64u, toB64u } from "@ideatrail/crypto/bytes";
import { recoveryProofMessage } from "@ideatrail/crypto/message";
import { verifyEd25519Raw } from "../auth/secrets";
import { checkJoinSecret } from "./device-add";
import { newId } from "@ideatrail/crypto/ids";
import type { AppEnv, Bindings } from "../env";
import { ApiError } from "../http/errors";
import { browserWrite } from "../http/browser";
import { ipLimit, type Limiter } from "../http/rate-limit";
import { readJson, zB64u, zId, zSealed } from "../http/validate";
import { consumeChallenge, saveChallenge, STEPUP_SECONDS } from "../auth/challenges";
import { newSession, requireSession } from "../auth/session";
import { actionOf } from "../auth/stepup";
import { authenticationOptions, registrationOptions, verifyAssertion, verifyRegistration, webauthnFailed } from "../auth/webauthn";
import { zAuthenticationResponse, zRegistrationResponse } from "../auth/webauthn-schema";
import { guard, runBatch } from "../db/change";
import { nowIso, toBytes } from "../db/values";

const RELOCK_ACCOUNT_PRIV = 0x81;
const ENVELOPE_KIND = 0x80;


/** Exactly one way in: new signup (pairing), new device (device add), or recovery. */
const zRegisterOptions = z.union([
  z.object({ pairing_session_id: zId }).strict(),
  z.object({ device_add_session_id: zId, join_secret: z.string().min(1).max(100) }).strict(),
  z.object({ recovery_challenge_id: zId, proof: zB64u(64) }).strict(),
]);

const zRegisterVerify = z.object({
  challenge_id: zId,
  response: zRegistrationResponse,
  account: z.object({ account_pubkey: zB64u(32), wrapped_account_privkey: zSealed(RELOCK_ACCOUNT_PRIV) }).optional(),
  envelope: z.object({ envelope_id: zId, wrapped_master_key: zSealed(ENVELOPE_KIND), label: zB64u().optional() }),
});

const zLoginVerify = z.object({ challenge_id: zId, response: zAuthenticationResponse });
const zKdfParams = z.object({ v: z.literal(1), vk: z.string() });
const zStepupOptions = z.object({
  method: z.enum(["POST", "PUT", "DELETE"]),
  path: z.string().regex(/^\/v1\/[A-Za-z0-9_/-]{1,200}$/),
});

const linkUsed = (what: string) => new ApiError(409, "link_used", `This ${what} was already used`);
const credentialExists = () => new ApiError(409, "credential_exists", "This passkey is already registered");

/** Map a UNIQUE/PK failure to the right 409 (credential vs client-chosen envelope id). */
function uniqueConflict(err: unknown): never {
  if (err instanceof Error && /passkey_credentials/.test(err.message)) throw credentialExists();
  if (err instanceof Error && /key_envelopes/.test(err.message)) throw new ApiError(409, "envelope_id_taken", "Envelope id already used; generate a new one");
  throw err;
}

async function existingCredentials(db: D1Database, userId: string) {
  const { results } = await db.prepare("SELECT credential_id FROM passkey_credentials WHERE user_id = ?").bind(userId).all<{ credential_id: string }>();
  return results.map((r) => r.credential_id);
}

export function webauthnRoutes(getLimiter: (env: Bindings) => Limiter) {
  const r = new Hono<AppEnv>();
  r.use("*", browserWrite);

  r.post("/register/options", ipLimit("register_options", getLimiter), async (c) => {
    const body = await readJson(c, zRegisterOptions);
    const db = c.env.DB;
    if ("pairing_session_id" in body) {
      const session = await db.prepare("SELECT user_id, expires_at FROM pairing_sessions WHERE session_id = ?")
        .bind(body.pairing_session_id).first<{ user_id: string | null; expires_at: string }>();
      if (!session) throw new ApiError(404, "pairing_not_found", "Signup link not found");
      if (session.expires_at <= nowIso()) throw new ApiError(410, "pairing_expired", "Signup link expired; start again from Claude Code");
      if (session.user_id) throw linkUsed("signup link");
      const userId = newId();
      const options = await registrationOptions(c.env, userId);
      const challengeId = await saveChallenge(db, "register", options.challenge, { pairing_session_id: body.pairing_session_id, pending_user_id: userId });
      return c.json({ challenge_id: challengeId, user_id: userId, options });
    }
    if ("device_add_session_id" in body) {
      const row = await db.prepare("SELECT user_id, join_secret_hash, sealed_mk, used_at, expires_at FROM device_add_sessions WHERE session_id = ?")
        .bind(body.device_add_session_id).first<{ user_id: string; join_secret_hash: string | null; sealed_mk: unknown; used_at: string | null; expires_at: string }>();
      if (!row) throw new ApiError(404, "device_add_not_found", "Device link not found");
      await checkJoinSecret(row, body.join_secret);
      if (row.expires_at <= nowIso()) throw new ApiError(410, "device_add_expired", "Device link expired; show a new QR code");
      if (row.sealed_mk === null) throw new ApiError(409, "not_ready", "Waiting for the other device");
      if (row.used_at) throw linkUsed("device link");
      const options = await registrationOptions(c.env, row.user_id, await existingCredentials(db, row.user_id));
      const challengeId = await saveChallenge(db, "register", options.challenge, { user_id: row.user_id, device_add_session_id: body.device_add_session_id });
      return c.json({ challenge_id: challengeId, user_id: row.user_id, options });
    }
    // Recovery: the caller must prove RK by signing the recovery challenge with the RK-derived key.
    // Check the proof against a read-only lookup first, so a bad proof cannot burn the real caller's challenge.
    const pending = await db.prepare(
      `SELECT c.challenge, c.user_id, k.kdf_params FROM webauthn_challenges c
         JOIN key_envelopes k ON k.envelope_id = c.recovery_envelope_id AND k.user_id = c.user_id AND k.method = 'recovery'
       WHERE c.challenge_id = ? AND c.purpose = 'recovery' AND c.used_at IS NULL AND c.expires_at > ?`,
    ).bind(body.recovery_challenge_id, nowIso()).first<{ challenge: string; user_id: string; kdf_params: string }>();
    if (!pending) throw new ApiError(400, "challenge_invalid", "Challenge expired or already used");
    if (!(await recoveryProofOk(pending.kdf_params, pending.challenge, body.proof))) {
      throw new ApiError(403, "recovery_proof_failed", "Recovery key check failed");
    }
    const ch = await consumeChallenge(db, body.recovery_challenge_id, ["recovery"]);
    if (ch.user_id !== pending.user_id || !ch.recovery_envelope_id) throw new ApiError(400, "challenge_invalid", "Challenge expired or already used");
    const userId = pending.user_id;
    const options = await registrationOptions(c.env, userId, await existingCredentials(db, userId));
    const challengeId = await saveChallenge(db, "register", options.challenge, { user_id: userId, recovery_envelope_id: ch.recovery_envelope_id });
    return c.json({ challenge_id: challengeId, user_id: userId, options });
  });

  r.post("/register/verify", ipLimit("register_verify", getLimiter), async (c) => {
    const body = await readJson(c, zRegisterVerify);
    const db = c.env.DB;
    const ch = await consumeChallenge(db, body.challenge_id, ["register"]);
    const info = await verifyRegistration(c.env, body.response, ch.challenge);
    const credentialId = info.credential.id;
    const taken = await db.prepare("SELECT 1 FROM passkey_credentials WHERE credential_id = ?").bind(credentialId).first();
    if (taken) throw credentialExists();

    const now = nowIso();
    let userId: string;
    let modeStmts: D1PreparedStatement[];
    if (ch.pairing_session_id && ch.pending_user_id) {
      if (!body.account) throw new ApiError(400, "invalid_input", "account");
      userId = ch.pending_user_id;
      modeStmts = [
        db.prepare("INSERT INTO users (user_id, account_pubkey, wrapped_account_privkey, created_at) VALUES (?, ?, ?, ?)")
          .bind(userId, body.account.account_pubkey, body.account.wrapped_account_privkey, now),
        db.prepare("UPDATE pairing_sessions SET user_id = ? WHERE session_id = ? AND user_id IS NULL AND expires_at > ?")
          .bind(userId, ch.pairing_session_id, now),
        guard(db),
      ];
    } else if (ch.device_add_session_id && ch.user_id) {
      if (body.account) throw new ApiError(400, "invalid_input", "account");
      userId = ch.user_id;
      modeStmts = [
        db.prepare("UPDATE device_add_sessions SET used_at = ?1 WHERE session_id = ?2 AND user_id = ?3 AND used_at IS NULL AND sealed_mk IS NOT NULL AND expires_at > ?1")
          .bind(now, ch.device_add_session_id, userId),
        guard(db),
      ];
    } else if (ch.recovery_envelope_id && ch.user_id) {
      if (body.account) throw new ApiError(400, "invalid_input", "account");
      userId = ch.user_id;
      // Recovery means a device may be lost: sign out every existing session for this account.
      modeStmts = [
        db.prepare("UPDATE key_envelopes SET last_used_at = ? WHERE envelope_id = ?").bind(now, ch.recovery_envelope_id),
        db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
      ];
    } else {
      throw new ApiError(400, "challenge_invalid", "Challenge expired or already used");
    }

    const session = await newSession(c, userId);
    await runBatch(db, [
      ...modeStmts,
      db.prepare("INSERT INTO passkey_credentials (credential_id, user_id, public_key, sign_count, transports, aaguid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(credentialId, userId, info.credential.publicKey, info.credential.counter, JSON.stringify(info.transports), info.aaguid, now),
      db.prepare("INSERT INTO key_envelopes (envelope_id, user_id, method, credential_id, wrapped_master_key, label, created_at) VALUES (?, ?, 'passkey', ?, ?, ?, ?)")
        .bind(body.envelope.envelope_id, userId, credentialId, body.envelope.wrapped_master_key, body.envelope.label ?? null, now),
      ...session.stmts,
    ], linkUsed(ch.pairing_session_id ? "signup link" : ch.device_add_session_id ? "device link" : "recovery request")).catch((err: unknown) => {
      if (err instanceof ApiError) throw err;
      if (err instanceof Error && /UNIQUE|PRIMARY KEY/.test(err.message)) uniqueConflict(err);
      throw err;
    });
    session.commit();
    return c.json({ user_id: userId });
  });

  r.post("/login/options", ipLimit("login_options", getLimiter), async (c) => {
    const options = await authenticationOptions(c.env);
    const challengeId = await saveChallenge(c.env.DB, "login", options.challenge, {});
    return c.json({ challenge_id: challengeId, options });
  });

  /** Passkey login = unlock: returns this credential's envelope (spec §11) and a new session. */
  r.post("/login/verify", ipLimit("login_verify", getLimiter), async (c) => {
    const body = await readJson(c, zLoginVerify);
    const ch = await consumeChallenge(c.env.DB, body.challenge_id, ["login"]);
    const { cred, touch } = await verifyAssertion(c.env, body.response, ch.challenge);
    const env = await c.env.DB.prepare("SELECT envelope_id, wrapped_master_key FROM key_envelopes WHERE credential_id = ? AND method = 'passkey'")
      .bind(cred.credential_id).first<{ envelope_id: string; wrapped_master_key: unknown }>();
    if (!env) throw webauthnFailed();
    const session = await newSession(c, cred.user_id);
    const db = c.env.DB;
    await runBatch(db, [
      touch, guard(db),
      db.prepare("UPDATE key_envelopes SET last_used_at = ? WHERE envelope_id = ?").bind(nowIso(), env.envelope_id),
      ...session.stmts,
    ], webauthnFailed());
    session.commit();
    return c.json({ user_id: cred.user_id, envelope: { envelope_id: env.envelope_id, wrapped_master_key: toB64u(toBytes(env.wrapped_master_key)) } });
  });

  /** A 2-minute challenge bound to one protected action ("METHOD /path") for this user. */
  r.post("/stepup/options", ipLimit("stepup_options", getLimiter), requireSession, async (c) => {
    const { method, path } = await readJson(c, zStepupOptions);
    const userId = c.get("userId")!;
    const { results } = await c.env.DB.prepare("SELECT credential_id, transports FROM passkey_credentials WHERE user_id = ?")
      .bind(userId).all<{ credential_id: string; transports: string | null }>();
    const options = await authenticationOptions(c.env, results.map((r) => ({ id: r.credential_id, transports: r.transports })));
    const challengeId = await saveChallenge(c.env.DB, "stepup", options.challenge, { user_id: userId, action: actionOf(method, path) }, STEPUP_SECONDS);
    return c.json({ challenge_id: challengeId, options });
  });

  return r;
}


async function recoveryProofOk(kdfParams: string, challenge: string, proof: Uint8Array): Promise<boolean> {
  let vk: Uint8Array;
  try {
    vk = fromB64u(zKdfParams.parse(JSON.parse(kdfParams)).vk);
  } catch {
    return false;
  }
  return verifyEd25519Raw(vk, recoveryProofMessage(challenge), proof);
}
