import { useState } from "preact/hooks";
import { fromB64u } from "@ideatrail/crypto/bytes";
import { ApiFailure, type Api } from "../../lib/api";
import type { OpenApproval } from "../../lib/approvals";
import { COPY, manageError } from "../../lib/copy";
import type { EngineList } from "../../lib/engine-list";
import { shortDate } from "../../lib/home/format";
import { isLockedError } from "../../lib/live-key";
import { sendDecision } from "../../lib/manage-actions";
import type { DashboardVault } from "../../lib/unlock";
import { useFocusOnMount } from "../ui/useFocus";
import { useStepup } from "../ui/useStepup";

interface Props { api: Api; vault: DashboardVault; signal: AbortSignal; items: readonly OpenApproval[]; onDecided(): void; onBack(): void }

function engineKem(list: EngineList, engineId: string): Uint8Array | null {
  const e = list.engines.find((x) => x.engine_id === engineId);
  return e ? fromB64u(e.kem_pubkey) : null;
}

function Item({ api, vault, signal, item, onDecided }: { api: Api; vault: DashboardVault; signal: AbortSignal; item: OpenApproval; onDecided(): void }) {
  const m = COPY.manage.approvals;
  const step = useStepup(api, "POST", `/v1/approvals/${item.approvalId}/decide`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function decide(decision: "approved" | "rejected") {
    if (busy) return;
    const kem = engineKem(vault.engineList, item.engineId);
    if (!kem) return setError(manageError(new Error("engine_gone"))); // checked before the device lock is asked
    const asked = step.take(); // the device lock first; nothing is sent if it is cancelled
    if (!asked) return;
    setBusy(true);
    setError(null);
    sendDecision({ api, vault, signal, kem, approvalId: item.approvalId, decision, asked })
      .then(onDecided, (e: unknown) => {
        if (isLockedError(e, signal)) return; // locked meanwhile: the lock screen is up, nothing was sent
        setError(manageError(e));
        setBusy(false);
        if (e instanceof ApiFailure) onDecided(); // closed or expired: refresh the list
      });
  }

  return (
    <li class="panel">
      <h3>{m.kinds[item.kind]}</h3>
      <p class="small">{m.from(item.engineName)} · {m.expires(shortDate(item.expiresAt))}</p>
      {item.update
        ? (
          <div class="update-info">
            <p>{m.updateLine(item.update.to, item.update.from)}</p>
            {item.update.changes.length > 0 && (
              <>
                <h4>{m.updateChanges}</h4>
                <ul class="plain" aria-label={m.updateChanges}>{item.update.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </>
            )}
          </div>
        )
        : item.folders.length === 0
          ? <p class="small">{m.noFolders}</p>
          : <ul class="plain">{item.folders.map((f) => <li key={f.path}>{f.name} <span class="small">({m.files(f.files)})</span></li>)}</ul>}
      <p class="error" role="alert">{error ?? ""}</p>
      <p class="small">{COPY.manage.stepupAhead}</p>
      <div class="row-actions">
        <button type="button" class="primary" disabled={!step.ready || busy} onClick={() => decide("approved")}>{m.approve}</button>
        <button type="button" disabled={!step.ready || busy} onClick={() => decide("rejected")}>{m.reject}</button>
      </div>
    </li>
  );
}

/** The waiting requests (5.9a). Each answer asks for the device lock first (step-up prepared before the click). */
export function Approvals({ api, vault, signal, items, onDecided, onBack }: Props) {
  const m = COPY.manage.approvals;
  const title = useFocusOnMount<HTMLHeadingElement>();
  return (
    <section class="manage" aria-labelledby="approvals-title">
      <button type="button" class="link" onClick={onBack}>{COPY.manage.back}</button>
      <h2 id="approvals-title" ref={title} tabIndex={-1}>{m.title}</h2>
      {items.length === 0 ? <p>{m.none}</p> : <ul class="plain" aria-label={m.list}>{items.map((i) => <Item key={i.approvalId} api={api} vault={vault} signal={signal} item={i} onDecided={onDecided} />)}</ul>}
    </section>
  );
}
