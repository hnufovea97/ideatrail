import { useState } from "preact/hooks";
import type { Api } from "../../lib/api";
import { COPY, manageError } from "../../lib/copy";
import { githubTokenFor, liveEngines } from "../../lib/engines";
import { guard, isLockedError } from "../../lib/live-key";
import type { SyncState } from "../../lib/sync/store";
import type { DashboardVault } from "../../lib/unlock";
import { useStepup } from "../ui/useStepup";

const MAX_TOKENS = 10;
interface Props { api: Api; vault: DashboardVault; signal: AbortSignal; sync: SyncState; onDeleted(): void }

/** 계정 지우기: what goes and what stays, then the device lock. Each live engine's GitHub access is cancelled (best effort). */
export function DeleteAccountSection({ api, vault, signal, sync, onDeleted }: Props) {
  const m = COPY.manage.account;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step = useStepup(api, "DELETE", confirming ? "/v1/account" : null);

  const erase = () => {
    if (busy) return;
    const asked = step.take();
    if (!asked) return;
    setBusy(true);
    setError(null);
    void asked.then(async (assertion) => {
      guard(signal);
      // a locked (wiped) key aborts the whole thing; any other failure to find a token only means "no token for that engine"
      const found = await Promise.all(liveEngines(vault.engineList).map((e) => githubTokenFor(vault, vault.engineList, sync.links.values(), e.engine_id)
        .catch((err: unknown) => { if (isLockedError(err, signal)) throw err; return null; })));
      guard(signal);
      const tokens = [...new Set(found.filter((t): t is string => t !== null))].slice(0, MAX_TOKENS);
      await api.deleteAccount({ ...(tokens.length ? { github_tokens: tokens } : {}), assertion });
    }).then(() => { if (!signal.aborted) onDeleted(); }, (e: unknown) => { if (isLockedError(e, signal)) return; setError(manageError(e)); setBusy(false); });
  };
  return (
    <section aria-labelledby="delete-title">
      <h2 id="delete-title">{m.title}</h2>
      <p class="small">{m.why}</p>
      <table class="plain-table">
        <tbody>
          <tr><th scope="row">{m.removedHead}</th><td>{m.removed}</td></tr>
          <tr><th scope="row">{m.keptHead}</th><td><p>{m.keptChain}</p><p>{m.keptGithub}</p></td></tr>
        </tbody>
      </table>
      <p class="banner">{m.keepBundles}</p>
      {confirming ? (
        <div role="group" aria-label={m.title}>
          <p>{m.confirm}</p>
          <p class="small">{COPY.manage.stepupAhead}</p>
          <div class="row-actions">
            <button type="button" class="primary" disabled={!step.ready || busy} onClick={erase}>{m.yes}</button>
            <button type="button" onClick={() => setConfirming(false)}>{COPY.manage.engines.cancel}</button>
          </div>
        </div>
      ) : <button type="button" onClick={() => setConfirming(true)}>{m.start}</button>}
      <p class="error" role="alert">{error ?? ""}</p>
    </section>
  );
}
