import { toB64u, toHex, utf8 } from "@ideatrail/crypto/bytes";
import { pairMac } from "@ideatrail/crypto/mac";
import { KIND, seal } from "@ideatrail/crypto/seal";
import type { DeliverBody } from "../api";
import { addEngine, sealEngineList, type EngineEntry, type EngineList } from "../engine-list";
import type { Vault } from "./account";

export interface DeliverInput {
  sessionId: string;
  psk: Uint8Array;
  kemPub: Uint8Array; // fingerprint-checked engine key (spec §9-3)
  vault: Vault;
  engine: EngineEntry;
  prev: { list: EngineList | null; version: number };
}

/** Spec §9-4: kind 8 {user_id, account_pubkey} to EK, HMAC with psk, engine list N+1 relocked. */
export async function buildDeliver(i: DeliverInput): Promise<{ body: DeliverBody; list: EngineList }> {
  const plain = utf8(JSON.stringify({ user_id: i.vault.userId, account_pubkey: toB64u(i.vault.akPub) }));
  const payload = await seal(KIND.pairing_payload, i.kemPub, { userId: i.vault.userId }, plain);
  const list = addEngine(i.prev.list, i.engine, i.prev.version);
  return {
    list,
    body: {
      payload: toB64u(payload),
      mac: toHex(pairMac(i.psk, i.sessionId, payload)),
      engine_list: sealEngineList(i.vault.mk, i.vault.userId, list),
      engine_list_version: list.version,
    },
  };
}
