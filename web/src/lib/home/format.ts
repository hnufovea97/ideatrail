// Dates on the home and idea-life screens (ADR-0018: "최초 기록 26.11.03 / 마지막 기록 26.11.18").
// Shown in the viewer's own time zone; tests pass one explicitly. Inputs are the signed RFC 3339 UTC times.
const DAY_MS = 86_400_000;

function ymd(iso: string, timeZone?: string): { y: string; m: string; d: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "2-digit", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** "26.11.03" */
export function shortDate(iso: string, timeZone?: string): string {
  const { y, m, d } = ymd(iso, timeZone);
  return `${y}.${m}.${d}`;
}

/** "11.03" */
export function monthDay(iso: string, timeZone?: string): string {
  const { m, d } = ymd(iso, timeZone);
  return `${m}.${d}`;
}

/** "11.10 – 11.18", or one date when both fall on the same day. */
export function dayRange(from: string, to: string, timeZone?: string): string {
  const a = monthDay(from, timeZone);
  const b = monthDay(to, timeZone);
  return a === b ? a : `${a} – ${b}`;
}

/** Whole days from `iso` to `now` (never negative). */
export const daysSince = (iso: string, now: Date): number => Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / DAY_MS));
