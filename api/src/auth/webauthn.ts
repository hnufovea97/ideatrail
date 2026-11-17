import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
  type VerifiedRegistrationResponse,
} from "@simplewebauthn/server";
import { decodeAttestationObject, isoBase64URL } from "@simplewebauthn/server/helpers";
import { ApiError } from "../http/errors";
import type { Bindings } from "../env";

/** EdDSA and ES256 only: cheap to verify inside the free plan's 10ms CPU budget. */
export const ALGORITHMS = [-8, -7];
const TIMEOUT_MS = 5 * 60 * 1000;

export const webauthnFailed = () => new ApiError(400, "webauthn_failed", "Passkey check failed");

export function registrationOptions(env: Bindings, userId: string) {
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
  });
}

/** Only "none" attestation is accepted; anything else is refused before any expensive parsing. */
function assertNoneAttestation(response: RegistrationResponseJSON) {
  try {
    const att = decodeAttestationObject(isoBase64URL.toBuffer(response.response.attestationObject));
    if (att.get("fmt") !== "none") throw new Error();
  } catch {
    throw webauthnFailed();
  }
}

export async function verifyRegistration(env: Bindings, response: RegistrationResponseJSON, challenge: string) {
  assertNoneAttestation(response);
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
  return result.registrationInfo;
}
