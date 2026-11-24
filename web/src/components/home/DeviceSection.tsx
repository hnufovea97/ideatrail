import { useState } from "preact/hooks";
import type { Api, CredentialMeta } from "../../lib/api";
import { COPY, manageError } from "../../lib/copy";
import { canRemoveDevice, storagePlace } from "../../lib/devices";
import { shortDate } from "../../lib/home/format";
import { guard, isLockedError } from "../../lib/live-key";
import type { DashboardVault } from "../../lib/unlock";
import { useStepup } from "../ui/useStepup";

interface Props { api: Api; vault: DashboardVault; signal: AbortSignal; credentials: readonly CredentialMeta[]; onChanged(): void }

function Row({ api, vault, signal, c, removable, onChanged }: { api: Api; vault: DashboardVault; signal: AbortSignal; c: CredentialMeta; removable: boolean; onChanged(): void }) {
  const m = COPY.manage.devices;
  const here = vault.credentialId !== undefined && vault.credentialId === c.credential_id;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step = useStepup(api, "POST", confirming ? `/v1/credentials/${c.credential_id}/remove` : null);

  const remove = () => {
    if (busy) return;
    const asked = step.take();
    if (!asked) return;
    setBusy(true);
    setError(null);
    void asked.then((a) => { guard(signal); return api.removeCredential(c.credential_id, a); }).then(() => { if (signal.aborted) return; setConfirming(false); setBusy(false); onChanged(); },
      (e: unknown) => { if (isLockedError(e, signal)) return; setError(manageError(e)); setBusy(false); });
  };
  return (
    <li class="panel">
      <h3>{storagePlace(c.aaguid)} {here ? <span class="badge">{m.thisOne}</span> : null}</h3>
      <p class="small">{m.added(shortDate(c.created_at))} · {c.last_used_at ? m.lastUsed(shortDate(c.last_used_at)) : m.neverUsed}</p>
      {removable && !confirming ? <button type="button" onClick={() => setConfirming(true)}>{m.remove}</button> : null}
      {confirming ? (
        <div role="group" aria-label={m.remove}>
          <p>{here ? m.confirmThis : m.confirm}</p>
          <p class="small">{COPY.manage.stepupAhead}</p>
          <div class="row-actions">
            <button type="button" class="primary" disabled={!step.ready || busy} onClick={remove}>{m.confirmYes}</button>
            <button type="button" onClick={() => setConfirming(false)}>{COPY.manage.engines.cancel}</button>
          </div>
        </div>
      ) : null}
      <p class="error" role="alert">{error ?? ""}</p>
    </li>
  );
}

/** 기기 목록: where each device lock is stored. Removing is offered only while another one is left. */
export function DeviceSection({ api, vault, signal, credentials, onChanged }: Props) {
  return (
    <section aria-labelledby="devices-title">
      <h2 id="devices-title">{COPY.manage.devices.title}</h2>
      <ul class="plain">{credentials.map((c) => <Row key={c.credential_id} api={api} vault={vault} signal={signal} c={c} removable={canRemoveDevice(credentials.length)} onChanged={onChanged} />)}</ul>
    </section>
  );
}
