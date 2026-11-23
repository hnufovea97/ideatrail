// kind 4 fragments (spec §15): opened with the account key; one shape per op (M5a). An op this dashboard does not
// know is left open (a newer dashboard may fold it), anything malformed is null.
import { fromB64u } from "@ideatrail/crypto/bytes";
import { KIND, open } from "@ideatrail/crypto/seal";
import { isMilestone, isSlot, parseTags, type Milestone, type RoutineSlot } from "../model/meta";
import type { DeltaRow } from "../sync/rows";
import { cleanLabel } from "../text";

export interface RoutineChange { slot: RoutineSlot; estimated: boolean; cleared: boolean }
export type DeltaBody =
  | { op: "title"; recordId: string | null; value: string }
  | { op: "tags"; recordId: string | null; value: string[] }
  | { op: "routine"; recordId: string | null; value: RoutineChange[] }
  | { op: "milestone"; recordId: string | null; value: { milestone: Milestone; certain: boolean } };

export const UNKNOWN_OP = "unknown_op" as const;
const ID = /^[0-9a-hjkmnp-tv-z]{26}$/;
const MAX_TITLE = 80;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function routineChanges(v: unknown): RoutineChange[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.flatMap((r): RoutineChange[] => (isObj(r) && isSlot(r.slot) ? [{ slot: r.slot, estimated: r.estimated === true, cleared: r.cleared === true }] : []));
  return out.length > 0 ? out : null;
}

export function parseDelta(raw: unknown): DeltaBody | typeof UNKNOWN_OP | null {
  if (!isObj(raw) || raw.v !== 1 || typeof raw.op !== "string") return null;
  if (raw.record_id !== undefined && !(typeof raw.record_id === "string" && ID.test(raw.record_id))) return null;
  const recordId = typeof raw.record_id === "string" ? raw.record_id : null;
  switch (raw.op) {
    case "title": {
      const value = typeof raw.value === "string" ? cleanLabel(raw.value, MAX_TITLE) : "";
      return value ? { op: "title", recordId, value } : null;
    }
    case "tags": {
      const value = parseTags(raw.value);
      return value ? { op: "tags", recordId, value } : null;
    }
    case "routine": {
      const value = routineChanges(raw.value);
      return value ? { op: "routine", recordId, value } : null;
    }
    case "milestone": {
      const v = raw.value;
      return isObj(v) && isMilestone(v.milestone) ? { op: "milestone", recordId, value: { milestone: v.milestone, certain: v.certain === true } } : null;
    }
    default:
      return UNKNOWN_OP;
  }
}

export async function openDelta(akPriv: Uint8Array, userId: string, row: DeltaRow): Promise<DeltaBody | typeof UNKNOWN_OP | null> {
  try {
    const pt = await open(KIND.delta, akPriv, { userId, rootId: row.root_id, recordId: row.delta_id, version: "0" }, fromB64u(row.sealed_delta));
    return parseDelta(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(pt)));
  } catch {
    return null;
  }
}
