import { CipherSuite, HkdfSha256 } from "@hpke/core";
import { DhkemX25519HkdfSha256 } from "@hpke/dhkem-x25519";
import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { x25519 } from "@noble/curves/ed25519.js";
import { ab, concat, utf8 } from "./bytes";
import { buildAAD, hasMagic, MAGIC, type AAD } from "./format";
import { pad, unpad } from "./pad";

/** Sealed blob kinds (spec §4). */
export const KIND = {
  record_meta: 1, record_body: 2, original: 3, delta: 4, nonce: 5, storage_token: 6,
  engine_inbox: 7, pairing_payload: 8, device_add_master: 9, approval_summary: 10, folder_suggestions: 11,
} as const;
export type Kind = (typeof KIND)[keyof typeof KIND];

const NAMES = new Map<number, string>(Object.entries(KIND).map(([name, kind]) => [kind, name]));
const ENC_LEN = 32;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + 1;

const suite = new CipherSuite({ kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Chacha20Poly1305() });
const importPub = (b: Uint8Array) => suite.kem.importKey("raw", ab(b), true);
const importPriv = (b: Uint8Array) => suite.kem.importKey("raw", ab(b), false);

function prepare(kind: number, a: AAD, auth: boolean) {
  const name = NAMES.get(kind);
  if (!name) throw new Error("unknown_kind");
  if (auth !== (kind === KIND.engine_inbox)) throw new Error("auth_mode_mismatch");
  return { info: utf8("ideatrail/v1/" + name), aad: buildAAD(name, a) };
}

async function sealWith(kind: number, recipientPub: Uint8Array, a: AAD, plaintext: Uint8Array, senderPriv?: Uint8Array) {
  const { info, aad } = prepare(kind, a, senderPriv !== undefined);
  const senderKey = senderPriv
    ? { privateKey: await importPriv(senderPriv), publicKey: await importPub(x25519.getPublicKey(senderPriv)) }
    : undefined;
  const ctx = await suite.createSenderContext({ recipientPublicKey: await importPub(recipientPub), info: ab(info), senderKey });
  const pt = kind === KIND.original ? plaintext : pad(plaintext);
  const ct = new Uint8Array(await ctx.seal(ab(pt), ab(aad)));
  return concat(MAGIC, Uint8Array.of(kind), new Uint8Array(ctx.enc), ct);
}

/** HPKE base-mode seal to the recipient's X25519 public key (every kind except 7). */
export const seal = (kind: number, recipientPub: Uint8Array, a: AAD, plaintext: Uint8Array) =>
  sealWith(kind, recipientPub, a, plaintext);

/** HPKE Auth-mode seal for kind 7; sender is the account private key. */
export const sealAuth = (kind: number, recipientPub: Uint8Array, senderPriv: Uint8Array, a: AAD, plaintext: Uint8Array) =>
  sealWith(kind, recipientPub, a, plaintext, senderPriv);

/** Raw HPKE recipient context (used for RFC 9180 conformance tests). */
export async function recipientContext(p: { recipientPriv: Uint8Array; enc: Uint8Array; info: Uint8Array; senderPub?: Uint8Array }) {
  return suite.createRecipientContext({
    recipientKey: await importPriv(p.recipientPriv),
    enc: ab(p.enc),
    info: ab(p.info),
    senderPublicKey: p.senderPub ? await importPub(p.senderPub) : undefined,
  });
}

async function openWith(kind: number, recipientPriv: Uint8Array, a: AAD, blob: Uint8Array, senderPub?: Uint8Array) {
  const { info, aad } = prepare(kind, a, senderPub !== undefined);
  try {
    if (blob.length < HEADER_LEN + ENC_LEN + TAG_LEN || !hasMagic(blob) || blob[3] !== kind) throw new Error();
    const ctx = await recipientContext({ recipientPriv, enc: blob.subarray(HEADER_LEN, HEADER_LEN + ENC_LEN), info, senderPub });
    const pt = new Uint8Array(await ctx.open(ab(blob.subarray(HEADER_LEN + ENC_LEN)), ab(aad)));
    return kind === KIND.original ? pt : unpad(pt);
  } catch {
    throw new Error("decrypt_failed"); // one error for every failure: no oracle
  }
}

/** Open a base-mode blob of the expected kind. */
export const open = (kind: number, recipientPriv: Uint8Array, a: AAD, blob: Uint8Array) => openWith(kind, recipientPriv, a, blob);

/** Open a kind 7 blob and prove it came from senderPub (the pinned account key). */
export const openAuth = (kind: number, recipientPriv: Uint8Array, senderPub: Uint8Array, a: AAD, blob: Uint8Array) =>
  openWith(kind, recipientPriv, a, blob, senderPub);
