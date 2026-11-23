import { COPY } from "../../lib/copy";
import type { DashboardVault } from "../../lib/unlock";

interface Props { vault: DashboardVault; onLock(): void }

/** The unlocked page. M5a shows only the chain status line; the home UI comes in M5b (5.4). */
export function OpenShell({ onLock }: Props) {
  return (
    <main class="screen dash">
      <h1 tabIndex={-1}>{COPY.dash.lockTitle}</h1>
      <p class="small" role="status">{COPY.dash.chain.checking}</p>
      <button type="button" onClick={onLock}>{COPY.dash.lockNow}</button>
    </main>
  );
}
