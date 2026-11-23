import { COPY } from "../copy";

export type ChainIssue =
  | { kind: "bad_row"; table: string }
  | { kind: "bad_signature"; table: "records" | "deltas"; id: string }
  | { kind: "unknown_engine"; table: "records" | "deltas"; id: string }
  | { kind: "gap"; engineId: string; missing: readonly string[] }
  | { kind: "duplicate_seq"; engineId: string; seq: string }
  | { kind: "revoked_mismatch"; engineId: string } // a disconnected engine's rows differ from the set frozen at disconnect
  | { kind: "rollback"; what: "log_seq" | "root_meta"; id: string }
  | { kind: "unreadable"; table: "records" | "deltas" | "roots"; id: string };

export type ChainStatus = { state: "checking" } | { state: "ok"; at: Date } | { state: "warn"; issues: readonly ChainIssue[] };

/** Any issue wins over everything; "ok" needs a finished pull with no issue at all. */
export function chainStatus(complete: boolean, issues: readonly ChainIssue[], at: Date): ChainStatus {
  if (issues.length > 0) return { state: "warn", issues };
  return complete ? { state: "ok", at } : { state: "checking" };
}

const hhmm = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;

export function chainLine(s: ChainStatus): string {
  if (s.state === "ok") return COPY.dash.chain.ok(hhmm(s.at));
  return s.state === "warn" ? COPY.dash.chain.warn : COPY.dash.chain.checking;
}
