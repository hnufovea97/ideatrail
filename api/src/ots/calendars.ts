import { toHex } from "@ideatrail/crypto/bytes";
import { bitcoinHeight, OtsError, parseTimestamp, pendingPoints, type Timestamp } from "./tree";

/** Exact hosts the server may contact (M0 S1 + public calendars). Nothing else, ever (SSRF). */
export const CALENDAR_HOSTS = new Set([
  "a.pool.opentimestamps.org",
  "b.pool.opentimestamps.org",
  "alice.btc.calendar.opentimestamps.org",
  "bob.btc.calendar.opentimestamps.org",
  "finney.calendar.eternitywall.com",
  "a.pool.eternitywall.com",
  "ots.btc.catallaxy.com",
]);

/** The allowed host of a calendar URL, or null: https only, no credentials, no port, exact host. */
export function calendarHost(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  return CALENDAR_HOSTS.has(u.hostname) ? u.hostname : null;
}

/** The server builds the request URL itself; the receipt's path is ignored. */
export const timestampUrl = (host: string, msg: Uint8Array) => `https://${host}/timestamp/${toHex(msg)}`;

/**
 * Validate a pending receipt at ingest: it must parse for `commitment`, contain at least one
 * pending point, every pending point must name an allowed calendar, and it must NOT already carry
 * a bitcoin attestation (only Cron's calendar upgrades may add one).
 * Note: the record's `calendar` field is the submission server (e.g. a.pool) and legitimately
 * differs from the calendar named inside the receipt (e.g. alice) — M0 S1 real data.
 */
export function checkPendingReceipt(bytes: Uint8Array, commitment: Uint8Array): Timestamp {
  const t = parseTimestamp(bytes, commitment);
  const points = pendingPoints(t);
  if (points.length === 0 || points.some((p) => calendarHost(p.uri) === null)) throw new OtsError("ots: calendar not allowed");
  if (bitcoinHeight(t) !== null) throw new OtsError("ots: pending receipt already claims a block");
  return t;
}
