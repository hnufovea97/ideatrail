import { formatTime } from "@ideatrail/crypto/ids";
import { ApiFailure, type Api, type PairingInfo, type RegisterVerifyBody } from "../api";
import { isRollback, openEngineList, rememberVersion, type EngineEntry, type VersionStore } from "../engine-list";
import type { PairingLink } from "../fragment";
import { registrationJSON, type Created } from "../webauthn";
import { newAccount, type Vault } from "./account";
import { buildDeliver } from "./pairing";

export interface PreparedAccount { vault: Vault; body: RegisterVerifyBody }

/** New account + envelope for this credential, built once so a retry sends the very same body. */
export function prepareAccount(p: { challengeId: string; userId: string; created: Created; prf: Uint8Array }): PreparedAccount {
  const a = newAccount(p.userId, p.prf, p.created.rawId);
  return { vault: a.vault, body: { challenge_id: p.challengeId, response: registrationJSON(p.created.credential), account: a.account, envelope: a.envelope } };
}

/**
 * register/verify (account + envelope, session cookie). After this resolves the credential exists on
 * the server, so callers must never "forget" it locally again. The PRF output stays in memory.
 */
export async function submitAccount(api: Api, p: PreparedAccount): Promise<Vault> {
  await api.registerVerify(p.body);
  return p.vault;
}

export const finishAccount = (api: Api, p: Parameters<typeof prepareAccount>[0]): Promise<Vault> => submitAccount(api, prepareAccount(p));

/**
 * Only a 4xx answer says the server did not keep the credential. Offline, a timeout, a 5xx or an
 * unreadable reply may have come after the server stored it: keep the passkey and retry the same body.
 */
export const verifyFailure = (e: unknown): "refused" | "unsure" =>
  e instanceof ApiFailure && e.status >= 400 && e.status < 500 ? "refused" : "unsure";

const engineEntry = (c: { link: PairingLink; info: PairingInfo }): EngineEntry => ({
  engine_id: c.info.engine_id, sign_pubkey: c.info.sign_pubkey, kem_pubkey: c.info.kem_pubkey,
  name: c.link.computerName, added_at: formatTime(new Date()),
});

/**
 * Confirm (the envelope was unwrapped once here — spec §11; idempotent), then hand the account key to
 * the engine and add it to the engine list (spec §9-4, §8). Safe to retry as a whole.
 */
export async function handOff(api: Api, c: { link: PairingLink; info: PairingInfo; kemPub: Uint8Array }, vault: Vault, store: VersionStore): Promise<EngineEntry> {
  await api.confirm();
  const acc = await api.account();
  if (isRollback(store, vault.userId, acc.engine_list_version)) throw new Error("engine_list_rollback");
  const prevList = acc.engine_list ? openEngineList(vault.mk, vault.userId, acc.engine_list_version, acc.engine_list) : null;
  const engine = engineEntry(c);
  const { body, list } = await buildDeliver({ sessionId: c.link.sessionId, psk: c.link.psk, kemPub: c.kemPub, vault, engine, prev: { list: prevList, version: acc.engine_list_version } });
  await api.deliver(c.link.sessionId, body);
  rememberVersion(store, vault.userId, list.version);
  return engine;
}

/** A retry after a failed handoff: if the server already holds the delivered blob, that try worked. */
export async function handOffAgain(api: Api, c: { link: PairingLink; info: PairingInfo; kemPub: Uint8Array }, vault: Vault, store: VersionStore): Promise<EngineEntry> {
  if ((await api.pairing(c.link.sessionId)).delivered) return engineEntry(c);
  return handOff(api, c, vault, store);
}
