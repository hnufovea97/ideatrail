import { newId } from "@ideatrail/crypto/ids";
import { ApiError } from "../http/errors";
import { inSeconds, nowIso } from "../db/values";

export type Purpose = "register" | "login" | "stepup" | "recovery";

export const CHALLENGE_SECONDS = 5 * 60;
export const STEPUP_SECONDS = 2 * 60;

export interface ChallengeRow {
  challenge_id: string;
  challenge: string;
  purpose: Purpose;
  user_id: string | null;
  pairing_session_id: string | null;
  device_add_session_id: string | null;
  recovery_envelope_id: string | null;
  pending_user_id: string | null;
  action: string | null;
}

type Binding = Partial<Omit<ChallengeRow, "challenge_id" | "challenge" | "purpose">>;

export async function saveChallenge(db: D1Database, purpose: Purpose, challenge: string, bind: Binding, ttlSeconds = CHALLENGE_SECONDS) {
  const id = newId();
  await db.prepare(
    `INSERT INTO webauthn_challenges (challenge_id, challenge, purpose, user_id, pairing_session_id, device_add_session_id,
       recovery_envelope_id, pending_user_id, action, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, challenge, purpose, bind.user_id ?? null, bind.pairing_session_id ?? null, bind.device_add_session_id ?? null,
    bind.recovery_envelope_id ?? null, bind.pending_user_id ?? null, bind.action ?? null, nowIso(), inSeconds(ttlSeconds)).run();
  return id;
}

/**
 * Use a challenge exactly once. Purpose (and user, when given) are part of the same UPDATE, so a
 * wrong-purpose or wrong-user attempt cannot burn someone else's challenge.
 */
export async function consumeChallenge(db: D1Database, challengeId: string, purposes: Purpose[], userId?: string): Promise<ChallengeRow> {
  const params: string[] = [nowIso(), challengeId, ...purposes];
  const purposeMarks = purposes.map((_, i) => `?${3 + i}`).join(", ");
  let userClause = "";
  if (userId) {
    params.push(userId);
    userClause = `AND user_id = ?${params.length}`;
  }
  const row = await db.prepare(
    `UPDATE webauthn_challenges SET used_at = ?1
       WHERE challenge_id = ?2 AND used_at IS NULL AND expires_at > ?1 AND purpose IN (${purposeMarks}) ${userClause}
     RETURNING *`,
  ).bind(...params).first<ChallengeRow>();
  if (!row) throw new ApiError(400, "challenge_invalid", "Challenge expired or already used");
  return row;
}
