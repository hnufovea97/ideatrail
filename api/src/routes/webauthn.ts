import { Hono } from "hono";
import { z } from "zod";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { toB64u } from "@ideatrail/crypto/bytes";
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
import { guard, runBatch } from "../db/change";
import { nowIso, toBytes } from "../db/values";

const RELOCK_ACCOUNT_PRIV = 0x81;
const ENVELOPE_KIND = 0x80;

const zResponse = z.custom<RegistrationResponseJSON>((v) => typeof v === "object" && v !== null && "response" in v);

const zRegisterOptions = z.object({ pairing_session_id: zId });

const zRegisterVerify = z.object({
  challenge_id: zId,
  response: zResponse,
  account: z.object({ account_pubkey: zB64u(32), wrapped_account_privkey: zSealed(RELOCK_ACCOUNT_PRIV) }),
  envelope: z.object({ envelope_id: zId, wrapped_master_key: zSealed(ENVELOPE_KIND), label: zB64u().optional() }),
});

const zAssertionResponse = z.custom<AuthenticationResponseJSON>((v) => typeof v === "object" && v !== null && "response" in v);
const zLoginVerify = z.object({ challenge_id: zId, response: zAssertionResponse });
const zStepupOptions = z.object({
  method: z.enum(["POST", "PUT", "DELETE"]),
  path: z.string().regex(/^\/v1\/[A-Za-z0-9_/-]{1,200}$/),
});

const signupConflict = new ApiError(409, "signup_conflict", "This signup link was already used");

export function webauthnRoutes(getLimiter: (env: Bindings) => Limiter) {
  const r = new Hono<AppEnv>();
  r.use("*", browserWrite);

  r.post("/register/options", ipLimit("register_options", getLimiter), async (c) => {
    const { pairing_session_id } = await readJson(c, zRegisterOptions);
    const session = await c.env.DB.prepare("SELECT user_id, expires_at FROM pairing_sessions WHERE session_id = ?")
      .bind(pairing_session_id).first<{ user_id: string | null; expires_at: string }>();
    if (!session) throw new ApiError(404, "pairing_not_found", "Signup link not found");
    if (session.expires_at <= nowIso()) throw new ApiError(410, "pairing_expired", "Signup link expired; start again from Claude Code");
    if (session.user_id) throw signupConflict;
    const userId = newId();
    const options = await registrationOptions(c.env, userId);
    const challengeId = await saveChallenge(c.env.DB, "register", options.challenge, { pairing_session_id, pending_user_id: userId });
    return c.json({ challenge_id: challengeId, user_id: userId, options });
  });

  r.post("/register/verify", async (c) => {
    const body = await readJson(c, zRegisterVerify);
    const ch = await consumeChallenge(c.env.DB, body.challenge_id, ["register"]);
    if (!ch.pairing_session_id || !ch.pending_user_id) throw new ApiError(400, "challenge_invalid", "Challenge expired or already used");
    const info = await verifyRegistration(c.env, body.response, ch.challenge);
    const credentialId = info.credential.id;
    const taken = await c.env.DB.prepare("SELECT 1 FROM passkey_credentials WHERE credential_id = ?").bind(credentialId).first();
    if (taken) throw new ApiError(409, "credential_exists", "This passkey is already registered");

    const userId = ch.pending_user_id;
    const now = nowIso();
    const db = c.env.DB;
    const session = await newSession(c, userId);
    await runBatch(db, [
      db.prepare("INSERT INTO users (user_id, account_pubkey, wrapped_account_privkey, created_at) VALUES (?, ?, ?, ?)")
        .bind(userId, body.account.account_pubkey, body.account.wrapped_account_privkey, now),
      db.prepare("UPDATE pairing_sessions SET user_id = ? WHERE session_id = ? AND user_id IS NULL AND expires_at > ?")
        .bind(userId, ch.pairing_session_id, now),
      guard(db),
      db.prepare("INSERT INTO passkey_credentials (credential_id, user_id, public_key, sign_count, transports, aaguid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(credentialId, userId, info.credential.publicKey, info.credential.counter, JSON.stringify(info.credential.transports ?? []), info.aaguid, now),
      db.prepare("INSERT INTO key_envelopes (envelope_id, user_id, method, credential_id, wrapped_master_key, label, created_at) VALUES (?, ?, 'passkey', ?, ?, ?, ?)")
        .bind(body.envelope.envelope_id, userId, credentialId, body.envelope.wrapped_master_key, body.envelope.label ?? null, now),
      ...session.stmts,
    ], signupConflict).catch((err: unknown) => {
      if (err instanceof Error && /UNIQUE|PRIMARY KEY/.test(err.message)) throw new ApiError(409, "credential_exists", "This passkey is already registered");
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
  r.post("/stepup/options", requireSession, async (c) => {
    const { method, path } = await readJson(c, zStepupOptions);
    const userId = c.get("userId")!;
    const { results } = await c.env.DB.prepare("SELECT credential_id, transports FROM passkey_credentials WHERE user_id = ?")
      .bind(userId).all<{ credential_id: string; transports: string | null }>();
    const options = await authenticationOptions(c.env, results.map((r) => ({ id: r.credential_id, transports: r.transports ? JSON.parse(r.transports) : undefined })));
    const challengeId = await saveChallenge(c.env.DB, "stepup", options.challenge, { user_id: userId, action: actionOf(method, path) }, STEPUP_SECONDS);
    return c.json({ challenge_id: challengeId, options });
  });

  return r;
}

