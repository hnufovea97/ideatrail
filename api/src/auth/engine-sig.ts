import type { Context, MiddlewareHandler } from "hono";
import { fromB64u } from "@ideatrail/crypto/bytes";
import { idField } from "@ideatrail/crypto/format";
import { messageFor } from "@ideatrail/crypto/message";
import { ApiError } from "../http/errors";
import { toBytes } from "../db/values";
import type { AppEnv } from "../env";

export const MAX_SKEW_SECONDS = 300n;
/** D1 INTEGER is signed 64-bit: sequences stop at 2^63-1 (spec §2 says uint64; the server caps it). */
export const MAX_SEQ = 2n ** 63n - 1n;

const SEQ_RE = /^[1-9][0-9]{0,18}$/;
const TS_RE = /^[0-9]{1,12}$/;
const ED25519_PUB = 32;
const ED25519_SIG = 64;

const rejected = () => new ApiError(401, "bad_signature", "Request signature rejected");

interface SignedRequest {
  engineId: string;
  reqSeq: bigint;
  message: Uint8Array;
  sig: Uint8Array;
}

/** Parse spec §8 headers and rebuild the exact signed bytes. Any malformed input → 401. */
async function readSigned(c: Context<AppEnv>): Promise<SignedRequest> {
  const h = (k: string) => c.req.header(k) ?? "";
  const [engineId, seq, ts, sigText] = [h("x-it-engine"), h("x-it-seq"), h("x-it-ts"), h("x-it-sig")];
  if (!SEQ_RE.test(seq) || !TS_RE.test(ts)) throw rejected();
  const reqSeq = BigInt(seq);
  const unixTs = BigInt(ts);
  if (reqSeq > MAX_SEQ) throw rejected();
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (unixTs > now + MAX_SKEW_SECONDS || unixTs < now - MAX_SKEW_SECONDS) throw rejected();
  try {
    if (idField(engineId) !== engineId) throw rejected();
    const sig = fromB64u(sigText);
    const url = new URL(c.req.url);
    const body = new Uint8Array(await c.req.arrayBuffer());
    const message = messageFor({ type: "request", method: c.req.method, path: url.pathname + url.search, body, engineId, reqSeq, unixTs });
    return { engineId, reqSeq, message, sig };
  } catch {
    throw rejected();
  }
}

async function verifyEd25519(pub: Uint8Array, msg: Uint8Array, sig: Uint8Array): Promise<boolean> {
  if (pub.length !== ED25519_PUB || sig.length !== ED25519_SIG) return false;
  try {
    const key = await crypto.subtle.importKey("raw", pub, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, sig, msg);
  } catch {
    return false;
  }
}

/**
 * Engine-signed routes. The signature is checked BEFORE the sequence moves, so a forged request
 * cannot burn an engine's sequence. The sequence check and update are one conditional UPDATE
 * (replay, ordering and revocation in a single atomic step).
 */
export const requireEngine: MiddlewareHandler<AppEnv> = async (c, next) => {
  const s = await readSigned(c);
  const row = await c.env.DB.prepare("SELECT sign_pubkey, user_id FROM engines WHERE engine_id = ? AND revoked_at IS NULL")
    .bind(s.engineId)
    .first<{ sign_pubkey: unknown; user_id: string }>();
  if (!row || !(await verifyEd25519(toBytes(row.sign_pubkey), s.message, s.sig))) throw rejected();
  const upd = await c.env.DB.prepare(
    "UPDATE engines SET last_req_seq = CAST(?1 AS INTEGER) WHERE engine_id = ?2 AND last_req_seq < CAST(?1 AS INTEGER) AND revoked_at IS NULL",
  ).bind(s.reqSeq.toString(), s.engineId).run();
  if (upd.meta.changes !== 1) throw rejected();
  c.set("engineId", s.engineId);
  c.set("userId", row.user_id);
  await next();
};

/**
 * Engine-signed routes on a pairing session (`/v1/pairing/:id/*`), before an engines row exists.
 * Same rules, using pairing_sessions.sign_pubkey and last_req_seq. Expiry is checked by the route
 * (the 10-minute limit applies only until /deliver — spec §9).
 */
export const requirePairingEngine: MiddlewareHandler<AppEnv> = async (c, next) => {
  const sessionId = c.req.param("id") ?? "";
  const s = await readSigned(c);
  const row = await c.env.DB.prepare("SELECT sign_pubkey FROM pairing_sessions WHERE session_id = ? AND engine_id = ?")
    .bind(sessionId, s.engineId)
    .first<{ sign_pubkey: unknown }>();
  if (!row || !(await verifyEd25519(toBytes(row.sign_pubkey), s.message, s.sig))) throw rejected();
  const upd = await c.env.DB.prepare(
    "UPDATE pairing_sessions SET last_req_seq = CAST(?1 AS INTEGER) WHERE session_id = ?2 AND last_req_seq < CAST(?1 AS INTEGER)",
  ).bind(s.reqSeq.toString(), sessionId).run();
  if (upd.meta.changes !== 1) throw rejected();
  c.set("engineId", s.engineId);
  await next();
};
