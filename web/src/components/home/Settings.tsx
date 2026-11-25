import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { AccountInfo, Api } from "../../lib/api";
import { COPY, manageError } from "../../lib/copy";
import type { VersionStore } from "../../lib/engine-list";
import { recoveryMadeAt } from "../../lib/home/reminder";
import type { SyncState } from "../../lib/sync/store";
import type { DashboardVault, VaultPatch } from "../../lib/unlock";
import { useFocusOnMount } from "../ui/useFocus";
import { AutoLockSection } from "./AutoLockSection";
import { DeleteAccountSection } from "./DeleteAccountSection";
import { DeviceSection } from "./DeviceSection";
import { EngineRows } from "./EngineRows";
import { NoteSection } from "./NoteSection";
import { RecoverySection } from "./RecoverySection";
import { RoutineSection } from "./RoutineSection";

interface Props {
  api: Api; vault: DashboardVault; signal: AbortSignal; sync: SyncState; store: VersionStore;
  onVault(patch: VaultPatch): void; onRefresh(): void; onDeleted(notice?: string): void; onBack(): void;
}

/** 설정 (5.9b): one main action per section. Account details are read again from the server after each change. */
export function Settings(p: Props) {
  const [acct, setAcct] = useState<AccountInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const title = useFocusOnMount<HTMLHeadingElement>();
  const latest = useRef(0); // an older answer must not replace a newer one
  const { api, signal } = p;
  const load = useCallback(() => {
    const mine = ++latest.current;
    void api.account().then((a) => { if (mine === latest.current && !signal.aborted) { setAcct(a); setError(null); } },
      (e: unknown) => { if (mine === latest.current && !signal.aborted) setError(manageError(e)); });
  }, [api, signal]);
  useEffect(load, [load]);

  const recoveryAt = acct ? recoveryMadeAt(acct) : null;
  return (
    <section class="manage settings" aria-labelledby="settings-title">
      <button type="button" class="link" onClick={p.onBack}>{COPY.manage.back}</button>
      <h2 id="settings-title" ref={title} tabIndex={-1}>{COPY.manage.settingsOpen}</h2>
      <p class="error" role="alert">{error ?? ""}</p>
      <AutoLockSection api={p.api} vault={p.vault} signal={p.signal} onVault={p.onVault} />
      <RoutineSection store={p.store} userId={p.vault.userId} />
      {acct ? <RecoverySection api={p.api} vault={p.vault} signal={p.signal} madeAt={recoveryAt} onSaved={load} /> : null}
      {acct ? <NoteSection api={p.api} vault={p.vault} signal={p.signal} blob={acct.recall_notes ?? null} /> : null}
      {acct ? <DeviceSection api={p.api} vault={p.vault} signal={p.signal} credentials={acct.credentials ?? []} onChanged={load} onRemovedHere={() => p.onDeleted(COPY.manage.devices.removedHere)} /> : null}
      <EngineRows api={p.api} vault={p.vault} signal={p.signal} sync={p.sync} onVault={p.onVault} onChanged={p.onRefresh} />
      <DeleteAccountSection api={p.api} vault={p.vault} signal={p.signal} sync={p.sync} onDeleted={() => p.onDeleted()} />
    </section>
  );
}
