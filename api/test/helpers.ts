import { env } from "cloudflare:workers";
import { newId } from "@ideatrail/crypto/ids";
import { nowIso } from "../src/db/values";

/** Insert a bare users row and return its user_id. */
export async function seedUser(opts: { confirmed?: boolean } = {}): Promise<string> {
  const userId = newId();
  await env.DB.prepare(
    "INSERT INTO users (user_id, account_pubkey, wrapped_account_privkey, confirmed_at, created_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(userId, new Uint8Array(32), new Uint8Array([0x49, 0x54, 0x31, 0x81]), opts.confirmed === false ? null : nowIso(), nowIso()).run();
  return userId;
}
