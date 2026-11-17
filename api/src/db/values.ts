/** D1 returns BLOB columns as number[] (checked in M2a); normalise to Uint8Array. */
export function toBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (Array.isArray(v)) return Uint8Array.from(v as number[]);
  throw new Error("not a blob");
}

/** The one timestamp format: RFC 3339 UTC, seconds, trailing Z — string comparison = time order. */
export const isoAt = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
export const nowIso = (): string => isoAt(Date.now());
export const inSeconds = (s: number): string => isoAt(Date.now() + s * 1000);
