import { toB64u, utf8 } from "@ideatrail/crypto/bytes";
import { formatTime, newId } from "@ideatrail/crypto/ids";
import { KIND, sealAuth } from "@ideatrail/crypto/seal";
import type { SealedMessage } from "./api";
import type { Vault } from "./signup/account";

export type InboxBody = { type: "connect_github" } | { type: "select_folders"; approval_id: string; folders: string[] };

/**
 * Spec §4 kind 7 / §15: HPKE Auth mode with the account private key, so the engine can tell the
 * server did not write it. AAD {user_id, root_id = approval_id or "-", record_id = msg_id}.
 */
export async function sealInbox(v: Vault, engineKemPub: Uint8Array, body: InboxBody, now: Date = new Date()): Promise<SealedMessage> {
  const msgId = newId();
  const rootId = body.type === "select_folders" ? body.approval_id : undefined;
  const plain = utf8(JSON.stringify({ v: 1, ...body, issued_at: formatTime(now) }));
  const sealed = await sealAuth(KIND.engine_inbox, engineKemPub, v.akPriv, { userId: v.userId, rootId, recordId: msgId }, plain);
  return { msg_id: msgId, sealed: toB64u(sealed) };
}
