import { fromB64u, fromHex, toB64u } from "@ideatrail/crypto/bytes";
import type { Bindings } from "./env";
import type { Fetcher } from "./github";
import { CURSOR_SQL } from "./db/change";
import { isoAt, nowIso } from "./db/values";
import { calendarHost, timestampUrl } from "./ots/calendars";
import { bitcoinHeight, MAX_RECEIPT_BYTES, mergeInto, parseTimestamp, pendingPoints, serializeTimestamp } from "./ots/tree";

/** Free plan: 50 outbound subrequests per invocation; keep 2 spare. */
export const FETCH_BUDGET = 48;
/** Receipts handled per run: parsing is CPU work (free plan 10ms), so stay well below the fetch budget. */
export const ANCHORS_PER_RUN = 8; // staging: 9 confirmations took 62ms CPU (≈20ms cold start + ≈4.5ms each)
const RESPONSE_CAP = 4096;
const FETCH_TIMEOUT_MS = 10_000;
const BASE_INTERVAL_S = 30 * 60;
const MAX_INTERVAL_S = 24 * 60 * 60;
export const GIVE_UP_ATTEMPTS = 14; // ~8 days with the backoff below
const CLEANUP_BATCH = 500;
const DAY_S = 86_400;

interface CalendarEntry { calendar: string; pending: string; attempts: number }
interface DueAnchor { record_id: string; user_id: string; calendars: string; commitment: string }

export const nextInterval = (attempts: number) => Math.min(MAX_INTERVAL_S, BASE_INTERVAL_S * 2 ** attempts);

/** Outcome counts per run (status codes / error kinds only — no URLs, no bodies). */
export type Tally = Record<string, number>;
const note = (t: Tally | undefined, k: string) => { if (t) t[k] = (t[k] ?? 0) + 1; };

/** GET with no redirects, a timeout, and at most RESPONSE_CAP bytes read. null = not available. */
async function fetchCapped(fetcher: Fetcher, url: string, tally?: Tally): Promise<Uint8Array | null> {
  let res: Response;
  try {
    res = await fetcher(url, {
      method: "GET",
      redirect: "manual", // Workers rejects "error"; manual = never follow, a 3xx is just "not 200"
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/vnd.opentimestamps.v1", "user-agent": "ideatrail-api (+https://github.com/hnufovea97)" },
    });
  } catch (e) {
    note(tally, `error:${e instanceof Error ? e.name : "unknown"}`);
    return null;
  }
  note(tally, `http:${res.status}`);
  if (res.status !== 200 || !res.body) {
    await res.body?.cancel();
    return null;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > RESPONSE_CAP) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null; // reset or timed-out stream: treat as "not yet"
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

type Outcome = { kind: "confirmed"; receipt: Uint8Array; height: number } | { kind: "pending"; entries: CalendarEntry[]; attempts: number };

/** Ask ONE calendar (the least-tried) for this anchor. The URL is built from the allowlisted host only. */
async function checkAnchor(a: DueAnchor, fetcher: Fetcher, tally?: Tally): Promise<Outcome> {
  let entries: CalendarEntry[];
  try {
    entries = JSON.parse(a.calendars) as CalendarEntry[];
    if (!Array.isArray(entries) || entries.length === 0) throw new Error();
  } catch {
    return { kind: "pending", entries: [], attempts: GIVE_UP_ATTEMPTS }; // corrupt row: stop checking it
  }
  const idx = entries.reduce((best, e, i) => (e.attempts < entries[best].attempts ? i : best), 0);
  const entry = entries[idx];
  const commitment = fromHex(a.commitment);
  const bump = (): Outcome => {
    entries[idx] = { ...entry, attempts: entry.attempts + 1 };
    return { kind: "pending", entries, attempts: Math.min(...entries.map((e) => e.attempts)) };
  };
  let tree;
  try {
    tree = parseTimestamp(fromB64u(entry.pending), commitment);
  } catch {
    return bump();
  }
  const point = pendingPoints(tree).find((p) => calendarHost(p.uri) !== null);
  if (!point) return bump();
  const body = await fetchCapped(fetcher, timestampUrl(calendarHost(point.uri)!, point.node.msg), tally);
  if (!body) return bump();
  try {
    mergeInto(point.node, parseTimestamp(body, point.node.msg));
    const merged = serializeTimestamp(tree);
    if (merged.length > MAX_RECEIPT_BYTES) return bump();
    parseTimestamp(merged, commitment); // must stay within every parser limit before it is stored
    const height = bitcoinHeight(tree);
    if (height !== null) return { kind: "confirmed", receipt: merged, height };
    entries[idx] = { ...entry, pending: toB64u(merged), attempts: entry.attempts + 1 };
    return { kind: "pending", entries, attempts: Math.min(...entries.map((e) => e.attempts)) };
  } catch (e) {
    note(tally, `parse:${e instanceof Error ? e.message.slice(0, 40) : "unknown"}`);
    return bump();
  }
}

export interface CronReport { checked: number; confirmed: number; fetches: number; cleaned: number; tally: Tally }

/** 15-minute job: fetch Bitcoin confirmations for due receipts, then clean up expired rows. */
export async function runCron(env: Bindings, fetcher: Fetcher = fetch): Promise<CronReport> {
  const db = env.DB;
  const now = nowIso();
  const { results: due } = await db.prepare(
    `SELECT a.record_id, a.user_id, a.calendars, r.commitment FROM anchors a JOIN records r ON r.record_id = a.record_id
      WHERE a.status = 'pending' AND a.next_check_at IS NOT NULL AND a.next_check_at <= ? ORDER BY a.next_check_at LIMIT ?`,
  ).bind(now, ANCHORS_PER_RUN).all<DueAnchor>();

  let fetches = 0;
  let confirmed = 0;
  const tally: Tally = {};
  const counting: Fetcher = (url, init) => { fetches++; return fetcher(url, init); };
  for (const a of due) {
    if (fetches >= FETCH_BUDGET) break;
    let out: Outcome;
    try {
      out = await checkAnchor(a, counting, tally);
    } catch {
      out = { kind: "pending", entries: [], attempts: GIVE_UP_ATTEMPTS };
    }
    // Saved per anchor, so progress survives if the run is cut short.
    if (out.kind === "confirmed") {
      confirmed++;
      await db.batch([
        db.prepare("UPDATE users SET change_seq = change_seq + 1 WHERE user_id = ?").bind(a.user_id),
        db.prepare(`UPDATE anchors SET status = 'confirmed', complete_receipt = ?, block_height = ?, confirmed_at = ?, next_check_at = NULL, change_seq = ${CURSOR_SQL}
                    WHERE record_id = ? AND status = 'pending'`).bind(toB64u(out.receipt), out.height, now, a.user_id, a.record_id),
      ]);
    } else {
      const next = out.attempts >= GIVE_UP_ATTEMPTS ? null : isoAt(Date.now() + nextInterval(out.attempts) * 1000);
      const calendars = out.entries.length ? JSON.stringify(out.entries) : a.calendars;
      await db.prepare("UPDATE anchors SET calendars = ?, next_check_at = ? WHERE record_id = ? AND status = 'pending'").bind(calendars, next, a.record_id).run();
    }
  }
  const cleaned = await cleanup(db);
  return { checked: due.length, confirmed, fetches, cleaned, tally };
}

/** Expired auth state, abandoned signups, old usage/audit rows — at most CLEANUP_BATCH rows per table per run. */
async function cleanup(db: D1Database): Promise<number> {
  const ago = (s: number) => isoAt(Date.now() - s * 1000);
  const del = (table: string, where: string, ...args: unknown[]) =>
    db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${where} LIMIT ${CLEANUP_BATCH})`).bind(...args);
  const results = await db.batch([
    del("webauthn_challenges", "expires_at < ?", ago(DAY_S)),
    del("sessions", "expires_at < ?", nowIso()),
    del("pairing_sessions", "expires_at < ?", ago(DAY_S)),
    del("device_add_sessions", "expires_at < ?", ago(DAY_S)),
    del("users", "confirmed_at IS NULL AND created_at < ?", ago(DAY_S)),
    del("usage_events", "at < ?", ago(90 * DAY_S)),
    del("audit_log", "at < ?", ago(90 * DAY_S)),
    del("repo_heads", "reported_at < ?", ago(90 * DAY_S)),
    del("engine_inbox", "created_at < ?", ago(30 * DAY_S)),
    del("pending_approvals", "status <> 'pending' AND COALESCE(decided_at, expires_at) < ?", ago(30 * DAY_S)),
  ]);
  return results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
}
