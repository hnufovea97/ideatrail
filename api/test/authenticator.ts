// A software WebAuthn authenticator for tests: ES256 key, "none" attestation, real signatures,
// so SimpleWebAuthn verifies its responses exactly as it would a browser's.
import { toB64u, utf8, concat } from "@ideatrail/crypto/bytes";

// --- minimal CBOR encoder (maps, ints, byte/text strings) ---------------------------------
type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;
function head(major: number, n: number): Uint8Array {
  if (n < 24) return Uint8Array.of((major << 5) | n);
  if (n < 0x100) return Uint8Array.of((major << 5) | 24, n);
  if (n < 0x10000) return Uint8Array.of((major << 5) | 25, n >> 8, n & 0xff);
  throw new Error("cbor: length too large for this encoder");
}
export function cbor(v: Cbor): Uint8Array {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") { const b = utf8(v); return concat(head(3, b.length), b); }
  if (v instanceof Uint8Array) return concat(head(2, v.length), v);
  const parts: Uint8Array[] = [head(5, v.size)];
  for (const [k, val] of v) parts.push(cbor(k), cbor(val));
  return concat(...parts);
}

const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", b));
const u32 = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);

/** WebCrypto ECDSA gives r‖s; WebAuthn wants ASN.1 DER. */
function derSignature(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let v = b.subarray(i);
    if (v[0] & 0x80) v = concat(Uint8Array.of(0), v);
    return concat(Uint8Array.of(0x02, v.length), v);
  };
  const body = concat(int(raw.subarray(0, 32)), int(raw.subarray(32)));
  return concat(Uint8Array.of(0x30, body.length), body);
}

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export interface AuthenticatorOptions { rpId: string; origin: string }
export interface CreationOptionsLike { challenge: string; user?: { id: string } }
export interface RequestOptionsLike { challenge: string }

export async function createAuthenticator(opts: AuthenticatorOptions) {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey) as ArrayBuffer);
  const credentialId = crypto.getRandomValues(new Uint8Array(16));
  const id = toB64u(credentialId);
  let userHandle = "";
  let signCount = 0;

  const clientData = (type: string, challenge: string, origin = opts.origin) =>
    utf8(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

  return {
    id,
    /** Next signCount to report on login (set 0 to mimic synced passkeys). */
    setSignCount(n: number) { signCount = n; },

    async register(o: CreationOptionsLike, override: { origin?: string; uv?: boolean; fmt?: string } = {}) {
      userHandle = o.user?.id ?? "";
      const cose = cbor(new Map<Cbor, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, rawPub.subarray(1, 33)], [-3, rawPub.subarray(33, 65)]]));
      const flags = FLAG_UP | FLAG_AT | (override.uv === false ? 0 : FLAG_UV);
      const authData = concat(await sha256(utf8(opts.rpId)), Uint8Array.of(flags), u32(signCount), new Uint8Array(16),
        Uint8Array.of(credentialId.length >> 8, credentialId.length & 0xff), credentialId, cose);
      const attestationObject = cbor(new Map<Cbor, Cbor>([["fmt", override.fmt ?? "none"], ["attStmt", new Map()], ["authData", authData]]));
      return {
        id, rawId: id, type: "public-key" as const, authenticatorAttachment: "platform" as const, clientExtensionResults: {},
        response: { clientDataJSON: toB64u(clientData("webauthn.create", o.challenge, override.origin)), attestationObject: toB64u(attestationObject), transports: ["internal" as const] },
      };
    },

    async login(o: RequestOptionsLike, override: { origin?: string; signCount?: number } = {}) {
      if (override.signCount !== undefined) signCount = override.signCount;
      else if (signCount > 0) signCount += 1;
      const authData = concat(await sha256(utf8(opts.rpId)), Uint8Array.of(FLAG_UP | FLAG_UV), u32(signCount));
      const cd = clientData("webauthn.get", o.challenge, override.origin);
      const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, concat(authData, await sha256(cd))));
      return {
        id, rawId: id, type: "public-key" as const, authenticatorAttachment: "platform" as const, clientExtensionResults: {},
        response: { clientDataJSON: toB64u(cd), authenticatorData: toB64u(authData), signature: toB64u(derSignature(raw)), userHandle: userHandle || undefined },
      };
    },
  };
}
