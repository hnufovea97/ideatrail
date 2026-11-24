import { useCallback, useEffect, useState } from "preact/hooks";
import type { AccountInfo, Api } from "../../lib/api";
import { COPY, manageError } from "../../lib/copy";
import type { VersionStore } from "../../lib/engine-list";
import { recoveryMadeAt } from "../../lib/home/reminder";
import type { SyncState } from "../../lib/sync/store";
import type { DashboardVault } from "../../lib/unlock";
import { AutoLockSection } from "./AutoLockSection";
import { DeleteAccountSection } from "./DeleteAccountSection";
import { DeviceSection } from "./DeviceSection";
import { EngineRows } from "./EngineRows";
import { NoteSection } from "./NoteSection";
import { RecoverySection } from "./RecoverySection";
import { RoutineSection } from "./RoutineSection";

interface Props {
  api: Api; vault: DashboardVault; sync: SyncState; store: VersionStore;
  onVault(v: DashboardVault): void; onRefresh(): void; onDeleted(): void; onBack(): void;
}

/** 설정 (5.9b): one main action per section. Account details are read again from the server after each change. */
export function Settings(p: Props) {
  const [acct, setAcct] = useState<AccountInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    void p.api.account().then((a) => { setAcct(a); setError(null); }, (e: unknown) => setError(manageError(e)));
  }, [p.api]);
  useEffect(load, [load]);

  const recoveryAt = acct ? recoveryMadeAt(acct) : null;
  return (
    <div class="manage settings">
      <button type="button" class="link" onClick={p.onBack}>{COPY.manage.back}</button>
      <h2 tabIndex={-1}>{COPY.manage.settingsOpen}</h2>
      <p class="error" role="alert">{error ?? ""}</p>
      <AutoLockSection api={p.api} vault={p.vault} onVault={p.onVault} />
      <RoutineSection store={p.store} userId={p.vault.userId} />
      {acct ? <RecoverySection api={p.api} vault={p.vault} madeAt={recoveryAt} onSaved={load} /> : null}
      {acct ? <NoteSection api={p.api} vault={p.vault} blob={acct.recall_notes ?? null} /> : null}
      {acct ? <DeviceSection api={p.api} vault={p.vault} credentials={acct.credentials ?? []} onChanged={load} /> : null}
      <EngineRows api={p.api} vault={p.vault} sync={p.sync} onVault={p.onVault} onChanged={p.onRefresh} />
      <DeleteAccountSection api={p.api} vault={p.vault} sync={p.sync} onDeleted={p.onDeleted} />
    </div>
  );
}
