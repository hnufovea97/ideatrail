import { fromB64u } from "@ideatrail/crypto/bytes";
import { messageFor, verify } from "@ideatrail/crypto/sign";
import type { Api, StorageLinkRow } from "./api";
import type { EngineEntry } from "./engine-list";

const MAX_PAGES = 20;

/** Only the engine's own signed storage link counts (the server could insert a row, not sign it). */
export function storageLinkValid(row: StorageLinkRow, engine: EngineEntry, userId: string): boolean {
  if (row.engine_id !== engine.engine_id || row.revoked_at || !row.enc_token) return false;
  const ms = Date.parse(row.created_at);
  if (!Number.isFinite(ms)) return false;
  try {
    const msg = messageFor({ type: "storage_link", userId, engineId: engine.engine_id, tokenSealed: fromB64u(row.enc_token), unixTs: BigInt(Math.floor(ms / 1000)) });
    return verify(fromB64u(engine.sign_pubkey), msg, row.engine_sig);
  } catch {
    return false;
  }
}

export async function findStorageLink(api: Api, cursor: number, engine: EngineEntry, userId: string): Promise<{ linked: boolean; cursor: number }> {
  let c = cursor;
  let linked = false;
  for (let i = 0; i < MAX_PAGES; i++) {
    const r = await api.sync(c);
    if ((r.changes.storage_links ?? []).some((row) => storageLinkValid(row, engine, userId))) linked = true;
    c = r.cursor;
    if (r.next_cursor === null) break;
  }
  return { linked, cursor: c };
}
