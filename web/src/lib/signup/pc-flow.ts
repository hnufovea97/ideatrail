import { formatTime } from "@ideatrail/crypto/ids";
import type { Api, PairingInfo } from "../api";
import { isRollback, openEngineList, rememberVersion, type EngineEntry, type VersionStore } from "../engine-list";
import type { PairingLink } from "../fragment";
import { registrationJSON, type Created } from "../webauthn";
import { newAccount, type Vault } from "./account";
import { buildDeliver } from "./pairing";

/**
 * register/verify (account + envelope, session cookie). After this resolves the credential exists on
 * the server, so callers must never "forget" it locally again. The PRF output stays in memory.
 */
export async function finishAccount(api: Api, p: { challengeId: string; userId: string; created: Created; prf: Uint8Array }): Promise<Vault> {
  const a = newAccount(p.userId, p.prf, p.created.rawId);
  await api.registerVerify({ challenge_id: p.challengeId, response: registrationJSON(p.created.credential), account: a.account, envelope: a.envelope });
  return a.vault;
}

/**
 * Confirm (the envelope was unwrapped once here — spec §11; idempotent), then hand the account key to
 * the engine and add it to the engine list (spec §9-4, §8). Safe to retry as a whole.
 */
export async function handOff(api: Api, c: { link: PairingLink; info: PairingInfo; kemPub: Uint8Array }, vault: Vault, store: VersionStore): Promise<EngineEntry> {
  await api.confirm();
  const acc = await api.account();
  if (isRollback(store, vault.userId, acc.engine_list_version)) throw new Error("engine_list_rollback");
  const prevList = acc.engine_list ? openEngineList(vault.mk, vault.userId, acc.engine_list_version, acc.engine_list) : null;
  const engine: EngineEntry = {
    engine_id: c.info.engine_id, sign_pubkey: c.info.sign_pubkey, kem_pubkey: c.info.kem_pubkey,
    name: c.link.computerName, added_at: formatTime(new Date()),
  };
  const { body, list } = await buildDeliver({ sessionId: c.link.sessionId, psk: c.link.psk, kemPub: c.kemPub, vault, engine, prev: { list: prevList, version: acc.engine_list_version } });
  await api.deliver(c.link.sessionId, body);
  rememberVersion(store, vault.userId, list.version);
  return engine;
}
