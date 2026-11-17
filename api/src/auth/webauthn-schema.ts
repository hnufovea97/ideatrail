import { z } from "zod";
import type { AuthenticationResponseJSON, AuthenticatorTransport, RegistrationResponseJSON } from "@simplewebauthn/server";

const b64u = (max: number) => z.string().min(1).max(max).regex(/^[A-Za-z0-9_-]+$/);

export const TRANSPORTS = ["ble", "hybrid", "internal", "nfc", "usb"] as const satisfies readonly AuthenticatorTransport[];

/** Keep only transports WebAuthn defines; anything else from a client or the DB is dropped. */
export function cleanTransports(v: unknown): AuthenticatorTransport[] {
  const list = Array.isArray(v) ? v : [];
  return list.filter((t): t is AuthenticatorTransport => (TRANSPORTS as readonly string[]).includes(t as string));
}

export function parseTransports(json: string | null): AuthenticatorTransport[] {
  try {
    return cleanTransports(json ? JSON.parse(json) : []);
  } catch {
    return [];
  }
}

const common = {
  id: b64u(1400),
  rawId: b64u(1400),
  type: z.literal("public-key"),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
};

export const zRegistrationResponse = z.object({
  ...common,
  response: z.object({
    clientDataJSON: b64u(4000),
    attestationObject: b64u(16000),
    transports: z.array(z.string().max(20)).max(10).optional(),
    publicKeyAlgorithm: z.number().int().optional(),
    publicKey: b64u(2000).optional(),
    authenticatorData: b64u(4000).optional(),
  }),
}).transform((v) => v as unknown as RegistrationResponseJSON);

export const zAuthenticationResponse = z.object({
  ...common,
  response: z.object({
    clientDataJSON: b64u(4000),
    authenticatorData: b64u(4000),
    signature: b64u(600),
    userHandle: b64u(200).optional(),
  }),
}).transform((v) => v as unknown as AuthenticationResponseJSON);
