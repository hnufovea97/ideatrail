// Staging CPU probe (QA S8). Seeds ONE throwaway test account + engine + session in the staging D1,
// then sends real requests so `wrangler tail` can report cpuTime per route. Usage:
//   node scripts/staging-probe.mjs <staging-base-url>
// Never point this at production.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";

const base = process.argv[2];
if (!base || !base.includes("staging")) throw new Error("usage: node scripts/staging-probe.mjs <staging url>");

const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";
function b32(bytes) {
  let out = "", acc = 0, bits = 0;
  for (const x of bytes) { acc = (acc << 8) | x; bits += 8; while (bits >= 5) { bits -= 5; out += CROCKFORD[(acc >> bits) & 31]; } acc &= (1 << bits) - 1; }
  if (bits) out += CROCKFORD[(acc << (5 - bits)) & 31];
  return out;
}
const id = () => b32(randomBytes(16));
const b64u = (b) => Buffer.from(b).toString("base64url");
const hex = (b) => Buffer.from(b).toString("hex");
const sha256hex = (b) => createHash("sha256").update(b).digest("hex");
const sealed = (kind, n = 300) => b64u(Buffer.concat([Buffer.from([0x49, 0x54, 0x31, kind]), randomBytes(n)]));
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

const userId = id(), engineId = id(), rootId = id();
const seed = randomBytes(32);
const pub = ed25519.getPublicKey(seed);
const token = b64u(randomBytes(32));
const later = new Date(Date.now() + 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z");

const sql = [
  `INSERT INTO users (user_id, account_pubkey, wrapped_account_privkey, confirmed_at, created_at) VALUES ('${userId}', x'${"00".repeat(32)}', x'49543181', '${now()}', '${now()}');`,
  `INSERT INTO engines (engine_id, user_id, sign_pubkey, kem_pubkey, created_at, change_seq) VALUES ('${engineId}', '${userId}', x'${hex(pub)}', x'${"00".repeat(32)}', '${now()}', 0);`,
  `INSERT INTO sessions (session_id, user_id, created_at, expires_at) VALUES ('${sha256hex(token)}', '${userId}', '${now()}', '${later}');`,
].join(" ");
execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "ideatrail-staging", "--remote", "--env", "staging", "--command", sql], { stdio: "ignore" });
console.log("seeded test account", userId);

let seq = 1n;
async function engine(method, path, body) {
  const text = body === undefined ? "" : JSON.stringify(body);
  const ts = BigInt(Math.floor(Date.now() / 1000));
  const s = seq++;
  const msg = ["ideatrail-v1-req", method, path, sha256hex(Buffer.from(text)), engineId, s.toString(), ts.toString()].join("\n");
  const sig = b64u(ed25519.sign(new TextEncoder().encode(msg), seed));
  const r = await fetch(base + path, { method, body: body === undefined ? undefined : text,
    headers: { "content-type": "application/json", "x-it-engine": engineId, "x-it-seq": s.toString(), "x-it-ts": ts.toString(), "x-it-sig": sig } });
  return r.status;
}
const browser = async (path) => (await fetch(base + path, { headers: { cookie: `__Host-it_s=${token}` } })).status;

const fx = JSON.parse(readFileSync(new URL("../../spec/vectors/ots/receipts.json", import.meta.url)));
const record = (logSeq) => ({
  record_id: id(), root_id: rootId, parent_ids: [], commitment: fx.digest_hex, manifest: false, recorded_at: now(),
  log_seq: String(logSeq), list_meta: sealed(1), body_hash: hex(randomBytes(32)), nonce_hash: hex(randomBytes(32)),
  engine_sig: b64u(randomBytes(64)),
  ots: [{ calendar: "https://a.pool.opentimestamps.org", pending: b64u(Buffer.from(fx.pending_alice_hex, "hex")) },
        { calendar: "https://b.pool.opentimestamps.org", pending: b64u(Buffer.from(fx.pending_bob_hex, "hex")) }],
});

const results = [];
results.push(["GET /v1/nope", (await fetch(base + "/v1/nope")).status]);
for (let i = 1; i <= 5; i++) results.push(["POST /v1/records", await engine("POST", "/v1/records", record(i))]);
for (let i = 6; i <= 7; i++) results.push(["POST /v1/deltas", await engine("POST", "/v1/deltas", { delta_id: id(), root_id: rootId, sealed_delta: sealed(4), log_seq: String(i), created_at: now(), engine_sig: b64u(randomBytes(64)) })]);
results.push(["GET /v1/anchors/confirmed", await engine("GET", "/v1/anchors/confirmed?since=0")]);
results.push(["GET /v1/sync", await browser("/v1/sync?cursor=0")]);
results.push(["GET /v1/account", await browser("/v1/account")]);
console.table(results);
console.log("test account to delete afterwards:", userId);
