import { concat, fromHex, toB64u, toHex } from "@ideatrail/crypto/bytes";
import { parseOtsFile, pendingPoints, serializeTimestamp, type Timestamp } from "@ideatrail/crypto/ots";
import { newId } from "@ideatrail/crypto/ids";
import fx from "../../spec/vectors/ots/receipts.json";

export const sealed = (kind: number, len = 300) => toB64u(concat(Uint8Array.of(0x49, 0x54, 0x31, kind), crypto.getRandomValues(new Uint8Array(len))));
const hex32 = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) => x.toString(16).padStart(2, "0")).join("");

/** A valid record body: real M0 pending receipt (alice via a.pool) for the M0 digest as commitment. */
export function recordBody(over: Partial<Record<string, unknown>> & { log_seq: string; root_id?: string }) {
  return {
    record_id: newId(),
    root_id: newId(),
    parent_ids: [],
    commitment: fx.digest_hex,
    manifest: false,
    recorded_at: "2026-11-17T09:00:00Z",
    list_meta: sealed(1),
    body_hash: hex32(),
    nonce_hash: hex32(),
    engine_sig: toB64u(crypto.getRandomValues(new Uint8Array(64))),
    ots: [{ calendar: "https://a.pool.opentimestamps.org", pending: toB64u(fromHex(fx.pending_alice_hex)) }],
    ...over,
  };
}

/** What the alice calendar returns for the pending message: the node's subtree without its pending attestation. */
export function aliceUpgrade(): { msgHex: string; bytes: Uint8Array } {
  const file = parseOtsFile(fromHex(fx.direct_alice_ots_hex));
  const point = pendingPoints(file.timestamp).find((p) => p.uri.includes("alice"))!;
  const sub: Timestamp = { msg: point.node.msg, attestations: [], ops: point.node.ops };
  return { msgHex: toHex(point.node.msg), bytes: serializeTimestamp(sub) };
}
