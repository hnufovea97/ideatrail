import type { AuthenticationResponseJSON, RegistrationResponseJSON, VerifiedRegistrationResponse } from "@simplewebauthn/server";
import { toBytes, nowIso } from "../db/values";
import { cleanTransports, parseTransports } from "./webauthn-schema";
import { ApiError } from "../http/errors";
import type { Bindings } from "../env";

// SimpleWebAuthn (+ CBOR/ASN.1) is loaded only by passkey routes, not on every cold start.
const lib = () => import("@simplewebauthn/server");
const helpers = () => import("@simplewebauthn/server/helpers");

/** EdDSA and ES256 only: cheap to verify inside the free plan's 10ms CPU budget. */
export const ALGORITHMS = [-8, -7];
const TIMEOUT_MS = 5 * 60 * 1000;

export const webauthnFailed = () => new ApiError(400, "webauthn_failed", "Passkey check failed");

export async function registrationOptions(env: Bindings, userId: string, exclude: string[] = []) {
  const { generateRegistrationOptions } = await lib();
  return generateRegistrationOptions({
    rpName: env.RP_NAME,
    rpID: env.RP_ID,
    userName: "Ideatrail",
    userDisplayName: "Ideatrail",
    userID: Uint8Array.from(new TextEncoder().encode(userId)),
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    supportedAlgorithmIDs: ALGORITHMS,
    timeout: TIMEOUT_MS,
    excludeCredentials: exclude.map((id) => ({ id })),
  });
}

/** Only "none" attestation is accepted; anything else is refused before any expensive parsing. */
async function assertNoneAttestation(response: RegistrationResponseJSON) {
  const { decodeAttestationObject, isoBase64URL } = await helpers();
  try {
    const att = decodeAttestationObject(isoBase64URL.toBuffer(response.response.attestationObject));
    if (att.get("fmt") !== "none") throw new Error();
  } catch {
    throw webauthnFailed();
  }
}

export async function verifyRegistration(env: Bindings, response: RegistrationResponseJSON, challenge: string) {
  await assertNoneAttestation(response);
  const { verifyRegistrationResponse } = await lib();
  let result: VerifiedRegistrationResponse;
  try {
    result = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: env.APP_ORIGIN,
      expectedRPID: env.RP_ID,
      requireUserVerification: true,
      supportedAlgorithmIDs: ALGORITHMS,
    });
  } catch {
    throw webauthnFailed();
  }
  if (!result.verified || !result.registrationInfo?.userVerified) throw webauthnFailed();
  const info = result.registrationInfo;
  return { ...info, transports: cleanTransports(info.credential.transports) };
}

export async function authenticationOptions(env: Bindings, allow: { id: string; transports: string | null }[] = []) {
  const { generateAuthenticationOptions } = await lib();
  return generateAuthenticationOptions({
    rpID: env.RP_ID,
    userVerification: "required",
    timeout: TIMEOUT_MS,
    allowCredentials: allow.map((a) => ({ id: a.id, transports: parseTransports(a.transports) })),
  });
}

interface CredentialRow { credential_id: string; user_id: string; public_key: unknown; sign_count: number; transports: string | null }

/**
 * Verify a passkey assertion against a stored credential (optionally required to belong to `userId`).
 * Returns the credential row plus the counter-update statement for the caller's batch. The update is
 * conditional (`sign_count < new`, unless the authenticator reports 0 as synced passkeys do) so two
 * racing uses of one response cannot both succeed.
 */
export async function verifyAssertion(env: Bindings, response: AuthenticationResponseJSON, challenge: string, userId?: string) {
  const cred = await env.DB.prepare("SELECT credential_id, user_id, public_key, sign_count, transports FROM passkey_credentials WHERE credential_id = ?")
    .bind(response.id).first<CredentialRow>();
  if (!cred || (userId && cred.user_id !== userId)) throw webauthnFailed();
  const { verifyAuthenticationResponse } = await lib();
  let newCounter: number;
  try {
    const v = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: env.APP_ORIGIN,
      expectedRPID: env.RP_ID,
      requireUserVerification: true,
      credential: {
        id: cred.credential_id,
        publicKey: Uint8Array.from(toBytes(cred.public_key)),
        counter: cred.sign_count,
        transports: parseTransports(cred.transports),
      },
    });
    if (!v.verified || !v.authenticationInfo.userVerified) throw new Error();
    newCounter = v.authenticationInfo.newCounter;
  } catch {
    throw webauthnFailed();
  }
  const touch = env.DB.prepare(
    "UPDATE passkey_credentials SET sign_count = ?1, last_used_at = ?2 WHERE credential_id = ?3 AND (?1 = 0 OR sign_count < ?1)",
  ).bind(newCounter, nowIso(), cred.credential_id);
  return { cred, touch };
}
