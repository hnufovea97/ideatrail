// Anchor confirmation (5.7, ADR-0013/0018): "확정" exists only here. The server's `confirmed` and block height are hints.
// The receipt is followed from the signed fingerprint to a bitcoin attestation; the block at that height must show,
// at BOTH explorers, the same block with the receipt's merkle root. Pure apart from the two explorer calls.
import { fromB64u } from "@ideatrail/crypto/bytes";
import { bitcoinPoints, MAX_RECEIPT_BYTES, parseTimestamp } from "@ideatrail/crypto/ots";
import { toHex } from "../commit";
import type { BlockInfo, Explorer } from "./explorers";

export type Confirmation =
  | { state: "confirmed"; height: number; time: string }
  | { state: "checking" } // not decided yet: no receipt, or an explorer could not answer (never shown as 확정)
  | { state: "mismatch" } // the two explorers contradict each other
  | { state: "invalid" }; // the receipt is not one, or does not lead to the block the chain shows

export interface Explorers { a: Explorer; b: Explorer }

const MAX_B64U = Math.ceil((MAX_RECEIPT_BYTES * 4) / 3) + 4;

/** Where the receipt says the fingerprint ended up: the lowest bitcoin height and that block's merkle root (display order). */
function claimOf(commitment: Uint8Array, receipt: string): { height: number; merkleRoot: string } | null {
  if (receipt.length === 0 || receipt.length > MAX_B64U) return null;
  try {
    const point = bitcoinPoints(parseTimestamp(fromB64u(receipt), commitment))[0];
    if (!point || point.msg.length !== 32) return null;
    return { height: point.height, merkleRoot: toHex(point.msg.slice().reverse()) }; // explorers show the root reversed
  } catch {
    return null;
  }
}

const asked = (e: Explorer, height: number, signal?: AbortSignal): Promise<BlockInfo | null> => e.blockAt(height, signal).catch(() => null);

export async function confirmAnchor(commitment: Uint8Array, receipt: string | null, ex: Explorers, signal?: AbortSignal): Promise<Confirmation> {
  if (receipt === null) return { state: "checking" };
  const claim = claimOf(commitment, receipt);
  if (!claim) return { state: "invalid" };
  const [a, b] = await Promise.all([asked(ex.a, claim.height, signal), asked(ex.b, claim.height, signal)]);
  if (!a || !b) return { state: "checking" };
  if (a.hash !== b.hash || a.merkleRoot !== b.merkleRoot) return { state: "mismatch" };
  if (a.merkleRoot !== claim.merkleRoot) return { state: "invalid" };
  return { state: "confirmed", height: claim.height, time: new Date(a.time * 1000).toISOString() };
}
