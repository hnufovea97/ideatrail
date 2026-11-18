import { fromB64u, fromHex, toB64u, toHex } from "@ideatrail/crypto/bytes";
import { newKemKeyPair, randomKey } from "@ideatrail/crypto/keypair";
import { bytesEqual, deviceJoinMac, deviceKeyMac } from "@ideatrail/crypto/mac";
import { KIND, open, seal } from "@ideatrail/crypto/seal";
import { ApiFailure, type Api, type RegisterVerifyBody } from "./api";
import type { Created } from "./webauthn";
import { registrationJSON } from "./webauthn";
import { makeEnvelope, type Vault } from "./signup/account";

const KEY_LEN = 32;

/** Server-supplied bytes that fail to decode are treated like a wrong MAC, never as a reason to send. */
function decode(f: (s: string) => Uint8Array, s: string): Uint8Array | null {
  try {
    return f(s);
  } catch {
    return null;
  }
}

export interface DeviceOffer { d: string; qpsk: Uint8Array; url: string; expiresAt: number }
export type OfferProgress = "waiting" | "sent" | "done" | "intruder";

/** PC, spec §10-1: a 2-minute session and the QR link carrying qpsk after #. */
export async function offerDevice(api: Api, appOrigin: string): Promise<DeviceOffer> {
  const { session_id, expires_at } = await api.deviceAddStart();
  const qpsk = randomKey();
  return { d: session_id, qpsk, url: `${appOrigin}/connect?d=${session_id}#v1.${toB64u(qpsk)}`, expiresAt: Date.parse(expires_at) };
}

/** PC, spec §10-3: once the joiner's MAC proves qpsk, seal MK to its temporary key (kind 9) + MAC2. */
export async function pollOffer(api: Api, offer: DeviceOffer, vault: Vault): Promise<OfferProgress> {
  const s = await api.deviceAddState(offer.d);
  if (s.used) return "done";
  if (s.key_uploaded) return "sent";
  if (!s.joined || !s.t_pub || !s.join_mac) return "waiting";
  const tPub = decode(fromB64u, s.t_pub);
  const mac = decode(fromHex, s.join_mac);
  if (!tPub || !mac || tPub.length !== KEY_LEN || !bytesEqual(deviceJoinMac(offer.qpsk, offer.d, tPub), mac)) return "intruder";
  const sealed = await seal(KIND.device_add_master, tPub, { userId: vault.userId }, vault.mk);
  await api.deviceAddUpload(offer.d, { sealed_mk: toB64u(sealed), mac: toHex(deviceKeyMac(offer.qpsk, offer.d, sealed)) });
  return "sent";
}

export interface Joined { d: string; qpsk: Uint8Array; tPriv: Uint8Array; joinSecret: string }

/** Phone, spec §10-2: temporary X25519 key T, joined with a MAC under qpsk. */
export async function joinOffer(api: Api, d: string, qpsk: Uint8Array): Promise<Joined> {
  const t = newKemKeyPair();
  const { join_secret } = await api.deviceAddJoin(d, { t_pub: toB64u(t.pub), mac: toHex(deviceJoinMac(qpsk, d, t.pub)) });
  return { d, qpsk, tPriv: t.priv, joinSecret: join_secret };
}

/** Phone, spec §10-4: null while the PC has not sent the key; throws if its MAC2 does not match. */
export async function receiveMasterKey(api: Api, j: Joined): Promise<{ userId: string; mk: Uint8Array } | null> {
  let r: { user_id: string; sealed_mk: string; mac: string };
  try {
    r = await api.deviceAddFetchKey(j.d, j.joinSecret);
  } catch (e) {
    if (e instanceof ApiFailure && e.code === "not_ready") return null;
    throw e;
  }
  const sealed = decode(fromB64u, r.sealed_mk);
  const mac = decode(fromHex, r.mac);
  if (!sealed || !mac || !bytesEqual(deviceKeyMac(j.qpsk, j.d, sealed), mac)) throw new Error("device_key_mismatch");
  const mk = await open(KIND.device_add_master, j.tPriv, { userId: r.user_id }, sealed);
  if (mk.length !== KEY_LEN) throw new Error("device_key_mismatch");
  return { userId: r.user_id, mk };
}

/** Phone: this device's own envelope (unwrapped once before upload), built once so a retry sends the same body. */
export function prepareDevice(p: { challengeId: string; userId: string; mk: Uint8Array; created: Created; prf: Uint8Array }): RegisterVerifyBody {
  const envelope = makeEnvelope(p.mk, p.userId, p.prf, p.created.rawId);
  return { challenge_id: p.challengeId, response: registrationJSON(p.created.credential), envelope };
}

/** Registered under the device-add session. */
export async function submitDevice(api: Api, body: RegisterVerifyBody): Promise<void> {
  await api.registerVerify(body);
}
