import { env } from "cloudflare:workers";
import { ed25519 } from "@noble/curves/ed25519.js";
import { newId } from "@ideatrail/crypto/ids";
import { sign, messageFor } from "@ideatrail/crypto/sign";
import { inSeconds, nowIso } from "../src/db/values";
import { seedUser } from "./helpers";

export interface TestEngine { engineId: string; seed: Uint8Array; signPub: Uint8Array; kemPub: Uint8Array }
export interface SeededEngine extends TestEngine { userId: string }
export interface SeededPairing extends TestEngine { sessionId: string }

export function makeEngine(): TestEngine {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  return { engineId: newId(), seed, signPub: ed25519.getPublicKey(seed), kemPub: crypto.getRandomValues(new Uint8Array(32)) };
}

export async function seedEngine(opts: { revoked?: boolean; userId?: string } = {}): Promise<SeededEngine> {
  const e = makeEngine();
  const userId = opts.userId ?? (await seedUser());
  await env.DB.prepare(
    "INSERT INTO engines (engine_id, user_id, sign_pubkey, kem_pubkey, created_at, revoked_at, change_seq) VALUES (?, ?, ?, ?, ?, ?, 0)",
  ).bind(e.engineId, userId, e.signPub, e.kemPub, nowIso(), opts.revoked ? nowIso() : null).run();
  return { ...e, userId };
}

export async function seedPairing(opts: { expired?: boolean } = {}): Promise<SeededPairing> {
  const e = makeEngine();
  const sessionId = newId();
  await env.DB.prepare(
    "INSERT INTO pairing_sessions (session_id, engine_id, sign_pubkey, kem_pubkey, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(sessionId, e.engineId, e.signPub, e.kemPub, nowIso(), opts.expired ? inSeconds(-1) : inSeconds(600)).run();
  return { ...e, sessionId };
}

/** RequestInit carrying spec §8 headers, signed by `e` over exactly this method/path/body. */
export function signedInit(e: TestEngine, method: string, path: string, body: string, reqSeq: bigint, unixTs = BigInt(Math.floor(Date.now() / 1000))): RequestInit {
  const bodyBytes = new TextEncoder().encode(body);
  const msg = messageFor({ type: "request", method, path, body: bodyBytes, engineId: e.engineId, reqSeq, unixTs });
  return {
    method,
    body: method === "GET" ? undefined : body,
    headers: {
      "content-type": "application/json",
      "x-it-engine": e.engineId,
      "x-it-seq": reqSeq.toString(),
      "x-it-ts": unixTs.toString(),
      "x-it-sig": sign(e.seed, msg),
    },
  };
}
