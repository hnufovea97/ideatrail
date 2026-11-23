// WebAuthn JSON <-> binary for the API (SimpleWebAuthn on the server), with PRF (spec §11).
// Every create/get here starts synchronously so callers can invoke them straight from a click. They are
// async functions: the body up to create/get still runs in the click, and a sync throw becomes a rejection.
import { ab, fromB64u, toB64u } from "@ideatrail/crypto/bytes";
import { PRF_SALT } from "@ideatrail/crypto/envelope";
import type { AssertionJSON, CreationOptionsJSON, RegistrationJSON, RequestOptionsJSON } from "./api";

const PRF_LEN = 32;
const prfInput = () => ({ prf: { eval: { first: ab(PRF_SALT) } } }) as AuthenticationExtensionsClientInputs;
const b64 = (b: ArrayBuffer) => toB64u(new Uint8Array(b));
const attachment = (c: PublicKeyCredential) =>
  c.authenticatorAttachment === "platform" || c.authenticatorAttachment === "cross-platform" ? c.authenticatorAttachment : undefined;

export function creationOptions(o: CreationOptionsJSON): PublicKeyCredentialCreationOptions {
  return {
    challenge: ab(fromB64u(o.challenge)),
    rp: o.rp,
    user: { id: ab(fromB64u(o.user.id)), name: o.user.name, displayName: o.user.displayName },
    pubKeyCredParams: o.pubKeyCredParams,
    timeout: o.timeout,
    attestation: "none",
    authenticatorSelection: { ...o.authenticatorSelection, userVerification: "required" }, // never weaker than the server asked
    excludeCredentials: (o.excludeCredentials ?? []).map((c) => ({ type: "public-key" as const, id: ab(fromB64u(c.id)) })),
    extensions: prfInput(),
  };
}

function prfOf(c: PublicKeyCredential): Uint8Array | null {
  const first = (c.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer | ArrayBufferView } } }).prf?.results?.first;
  if (!first) return null;
  const bytes = first instanceof ArrayBuffer ? new Uint8Array(first) : new Uint8Array(first.buffer, first.byteOffset, first.byteLength);
  return bytes.length === PRF_LEN ? bytes.slice() : null;
}

function asCredential(c: Credential | null): PublicKeyCredential {
  if (!c || (c as PublicKeyCredential).type !== "public-key") throw new Error("webauthn_failed");
  return c as PublicKeyCredential;
}

export interface Created { credential: PublicKeyCredential; rawId: Uint8Array; prf: Uint8Array | null }

/** Call directly in a click handler: no await before create (Safari, QA B4). */
export async function createPasskey(o: CreationOptionsJSON, nav: CredentialsContainer = navigator.credentials): Promise<Created> {
  const credential = asCredential(await nav.create({ publicKey: creationOptions(o) }));
  return { credential, rawId: new Uint8Array(credential.rawId), prf: prfOf(credential) };
}

/** Spec §11 P3: when create gave no PRF output, one get on the same credential (local challenge, not sent anywhere). */
export async function readPrf(rawId: Uint8Array, rpId: string | undefined, nav: CredentialsContainer = navigator.credentials): Promise<Uint8Array | null> {
  const c = await nav.get({
    publicKey: {
      challenge: ab(crypto.getRandomValues(new Uint8Array(32))),
      rpId,
      allowCredentials: [{ type: "public-key", id: ab(rawId) }],
      userVerification: "required",
      extensions: prfInput(),
    },
  });
  return prfOf(asCredential(c));
}

/** Server step-up: assertion only (no PRF). Starts synchronously. */
export async function assertWithPasskey(o: RequestOptionsJSON, nav: CredentialsContainer = navigator.credentials): Promise<AssertionJSON> {
  const c = await nav.get({
    publicKey: {
      challenge: ab(fromB64u(o.challenge)),
      rpId: o.rpId,
      timeout: o.timeout,
      userVerification: "required",
      allowCredentials: (o.allowCredentials ?? []).map((c) => ({ type: "public-key" as const, id: ab(fromB64u(c.id)) })),
    },
  });
  return assertionJSON(asCredential(c));
}

export interface Unlocked { assertion: AssertionJSON; rawId: Uint8Array; prf: Uint8Array | null }

/**
 * Login = unlock (UX "기기 잠금 한 번 = 로그인 + 열쇠 풀기"): the server's challenge plus the PRF salt in one get.
 * The PRF output stays here; assertionJSON always sends `clientExtensionResults: {}`. Starts synchronously.
 */
export async function assertWithPrf(o: RequestOptionsJSON, nav: CredentialsContainer = navigator.credentials): Promise<Unlocked> {
  const c = asCredential(await nav.get({
    publicKey: {
      challenge: ab(fromB64u(o.challenge)),
      rpId: o.rpId,
      timeout: o.timeout,
      userVerification: "required",
      allowCredentials: (o.allowCredentials ?? []).map((x) => ({ type: "public-key" as const, id: ab(fromB64u(x.id)) })),
      extensions: prfInput(),
    },
  }));
  return { assertion: assertionJSON(c), rawId: new Uint8Array(c.rawId), prf: prfOf(c) };
}

/** What /register/verify receives. Extension results are always {} — the PRF output never leaves the browser. */
export function registrationJSON(c: PublicKeyCredential): RegistrationJSON {
  const r = c.response as AuthenticatorAttestationResponse;
  const publicKey = r.getPublicKey?.();
  const authData = r.getAuthenticatorData?.();
  return {
    id: c.id, rawId: b64(c.rawId), type: "public-key", authenticatorAttachment: attachment(c), clientExtensionResults: {},
    response: {
      clientDataJSON: b64(r.clientDataJSON),
      attestationObject: b64(r.attestationObject),
      transports: r.getTransports?.() ?? [],
      publicKeyAlgorithm: r.getPublicKeyAlgorithm?.(),
      publicKey: publicKey ? b64(publicKey) : undefined,
      authenticatorData: authData ? b64(authData) : undefined,
    },
  };
}

function assertionJSON(c: PublicKeyCredential): AssertionJSON {
  const r = c.response as AuthenticatorAssertionResponse;
  return {
    id: c.id, rawId: b64(c.rawId), type: "public-key", authenticatorAttachment: attachment(c), clientExtensionResults: {},
    response: {
      clientDataJSON: b64(r.clientDataJSON),
      authenticatorData: b64(r.authenticatorData),
      signature: b64(r.signature),
      userHandle: r.userHandle ? b64(r.userHandle) : undefined,
    },
  };
}

/**
 * The credential was never registered on the server (no PRF): ask the authenticator to forget it.
 * Best effort — only browsers with signalUnknownCredential support it; nothing else depends on it.
 */
export async function forgetCredential(rpId: string, rawId: Uint8Array): Promise<void> {
  const pkc = (globalThis as { PublicKeyCredential?: { signalUnknownCredential?: (o: { rpId: string; credentialId: string }) => Promise<void> } }).PublicKeyCredential;
  if (typeof pkc?.signalUnknownCredential !== "function") return;
  try {
    await pkc.signalUnknownCredential({ rpId, credentialId: toB64u(rawId) });
  } catch {
    // The server never saw this credential, so a failed hint leaves no account state behind.
  }
}
