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
