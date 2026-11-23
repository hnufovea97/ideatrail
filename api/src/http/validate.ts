import type { Context } from "hono";
import { z } from "zod";
import { fromB64u, fromHex } from "@ideatrail/crypto/bytes";
import { ApiError } from "./errors";

const invalid = (message = "Invalid request body") => new ApiError(400, "invalid_input", message);

/** Read the JSON body and validate it; any failure is a 400 with no echo of the input. */
export async function readJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw invalid("Body must be JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.path.join(".") || undefined);
  return parsed.data;
}

/** 26-char lowercase Crockford id (spec §2). */
export const zId = z.string().regex(/^[0-9a-hjkmnp-tv-z]{26}$/);

/** base64url → bytes, optionally with an exact length. */
export const zB64u = (len?: number) =>
  z.string().max(90_000).transform((s, ctx) => {
    try {
      const b = fromB64u(s);
      if (len !== undefined && b.length !== len) throw new Error();
      return b;
    } catch {
      ctx.addIssue({ code: "custom", message: "bad base64url" });
      return z.NEVER;
    }
  });

/** A sealed/relocked blob: base64url bytes starting with "IT1" + the expected kind byte (spec §4–§5). */
export const zSealed = (kindByte: number) =>
  zB64u().refine((b) => b.length > 4 && b[0] === 0x49 && b[1] === 0x54 && b[2] === 0x31 && b[3] === kindByte, "bad sealed blob");

/** Lowercase hex of an exact byte length. */
export const zHex = (bytes: number) => z.string().regex(new RegExp(`^[0-9a-f]{${bytes * 2}}$`)).transform((s) => fromHex(s));

/** zSealed with a byte ceiling (per-field caps — M2b review). */
export const zSealedMax = (kindByte: number, maxBytes: number) => zSealed(kindByte).refine((b) => b.length <= maxBytes, "sealed blob too large");

/** base64url bytes with a ceiling. */
export const zB64uMax = (maxBytes: number) => zB64u().refine((b) => b.length <= maxBytes, "too large");

/** Lowercase hex kept as text (e.g. commitments stored as TEXT). */
export const zHexText = (bytes: number) => z.string().regex(new RegExp(`^[0-9a-f]{${bytes * 2}}$`));

/** RFC 3339 UTC seconds with Z (spec §2). */
export const zTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

/** How far a signed time may run ahead of the server clock (drift allowance; the dashboard uses the same bound). */
export const MAX_FUTURE_SKEW_MS = 10 * 60_000;

/** A signed time from the far future would win every "later" comparison in the dashboard merge: refuse it at ingest. */
export function assertNotFuture(time: string): void {
  if (Date.parse(time) > Date.now() + MAX_FUTURE_SKEW_MS) throw new ApiError(400, "future_time", "Signed time is ahead of the server clock");
}

const MAX_SEQ = 2n ** 63n - 1n;
/** A sequence number as a decimal string, 1..2^63-1 (spec §2, server cap). */
export const zSeq = z.string().regex(/^[1-9][0-9]{0,18}$/).refine((s) => BigInt(s) <= MAX_SEQ, "sequence too large");
