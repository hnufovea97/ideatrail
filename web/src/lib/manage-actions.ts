// The actions of the management screens that wait for the device lock, as plain functions (testable without a browser).
// Each one checks the open vault's signal after every wait and before every key use or request: a lock that came in the
// meantime has wiped the keys, and nothing may be sealed or sent with them.
import type { Api, StepupAssertion } from "./api";
import type { EngineList, VersionStore } from "./engine-list";
import { rememberVersion } from "./engine-list";
import { githubTokenFor, planDisconnect, sealRevoked } from "./engines";
import { sealInbox } from "./inbox";
import { guard } from "./live-key";
import type { SyncState } from "./sync/store";
import type { DashboardVault } from "./unlock";

/** The engine's rows are not all accounted for: the disconnect is not offered. */
export class DisconnectRefused extends Error {
  constructor() {
    super("disconnect_refused");
    this.name = "DisconnectRefused";
  }
}

export async function sendDecision(d: {
  api: Pick<Api, "decide">; vault: DashboardVault; signal: AbortSignal; kem: Uint8Array; approvalId: string;
  decision: "approved" | "rejected"; asked: Promise<StepupAssertion>;
}): Promise<void> {
  const assertion = await d.asked;
  guard(d.signal);
  const message = await sealInbox(d.vault, d.kem, { type: "approval_result", approval_id: d.approvalId, decision: d.decision });
  guard(d.signal);
  await d.api.decide(d.approvalId, { decision: d.decision, message, assertion });
}

/** Returns the list that was saved. The cutoff is built only after the device lock answered, from what is loaded now. */
export async function disconnectEngine(d: {
  api: Pick<Api, "revokeEngine">; vault: DashboardVault; sync: SyncState; marks: VersionStore; signal: AbortSignal;
  engineId: string; asked: Promise<StepupAssertion>; now?: Date;
}): Promise<EngineList> {
  const assertion = await d.asked;
  guard(d.signal);
  const plan = planDisconnect(d.vault.userId, d.vault.engineList, d.sync, d.marks, d.engineId, d.now ?? new Date());
  if (!plan.ok) throw new DisconnectRefused();
  const token = await githubTokenFor(d.vault, d.vault.engineList, d.sync.links.values(), d.engineId); // sent once, never kept
  guard(d.signal);
  const engine_list = sealRevoked(d.vault.mk, d.vault.userId, plan.next);
  guard(d.signal);
  await d.api.revokeEngine(d.engineId, { engine_list, engine_list_version: plan.next.version, ...(token ? { github_token: token } : {}), assertion });
  rememberVersion(d.marks, d.vault.userId, plan.next.version); // the server has it now, whatever the screen does next
  return plan.next;
}
