import { utf8 } from "./bytes";

export const MAGIC = utf8("IT1");
export const CRYPTO_VERSION = "1";
export const SEP_AAD = "\x1f";
export const SEP_SIGN = "\n";

/** Join fields; any field containing 0x1F or 0x0A is rejected (spec §1). */
export function joinFields(sep: string, fields: string[]): string {
  for (const f of fields) if (f.includes("\x1f") || f.includes("\n")) throw new Error("bad_field");
  return fields.join(sep);
}

export const orDash = (s?: string): string => (s ? s : "-");

export interface AAD {
  userId?: string;
  rootId?: string;
  recordId?: string;
  version?: string;
}

/** AAD = join(0x1F, ["IT1", name, user_id, root_id, record_id, version, "1"]) — spec §4. */
export const buildAAD = (name: string, a: AAD): Uint8Array =>
  utf8(joinFields(SEP_AAD, ["IT1", name, orDash(a.userId), orDash(a.rootId), orDash(a.recordId), orDash(a.version), CRYPTO_VERSION]));

export const hasMagic = (b: Uint8Array): boolean => b.length >= 3 && b[0] === MAGIC[0] && b[1] === MAGIC[1] && b[2] === MAGIC[2];
