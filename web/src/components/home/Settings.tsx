import type { Api } from "../../lib/api";
import { COPY } from "../../lib/copy";
import type { SyncState } from "../../lib/sync/store";
import type { DashboardVault } from "../../lib/unlock";
import { EngineRows } from "./EngineRows";

interface Props { api: Api; vault: DashboardVault; sync: SyncState; onVault(v: DashboardVault): void; onRefresh(): void; onBack(): void }

/** 설정: engine rows for now (5.9a); the other sections follow in 5.9b. */
export function Settings(p: Props) {
  return (
    <div class="manage settings">
      <button type="button" class="link" onClick={p.onBack}>{COPY.manage.back}</button>
      <h2 tabIndex={-1}>{COPY.manage.settingsOpen}</h2>
      <EngineRows api={p.api} vault={p.vault} sync={p.sync} onVault={p.onVault} onChanged={p.onRefresh} />
    </div>
  );
}
