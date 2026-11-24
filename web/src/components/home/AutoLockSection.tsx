import { useState } from "preact/hooks";
import type { Api } from "../../lib/api";
import { COPY, manageError } from "../../lib/copy";
import type { DashboardVault } from "../../lib/unlock";

const CHOICES = [1, 3, 5] as const;
interface Props { api: Api; vault: DashboardVault; onVault(v: DashboardVault): void }

/** 자동 잠금: saved on the server, and the open vault takes it at once (the timer restarts with the new vault). */
export function AutoLockSection({ api, vault, onVault }: Props) {
  const m = COPY.manage.autoLock;
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const pick = (minutes: 1 | 3 | 5) => {
    setError(null);
    setSaved(false);
    void api.savePrefs({ auto_lock_minutes: minutes }).then(() => {
      setSaved(true);
      onVault({ ...vault, autoLockMinutes: minutes });
    }, (e: unknown) => setError(manageError(e)));
  };
  return (
    <section aria-labelledby="autolock-title">
      <h2 id="autolock-title">{m.title}</h2>
      <p class="small">{m.why}</p>
      <div class="row-actions" role="group" aria-labelledby="autolock-title">
        {CHOICES.map((c) => <button key={c} type="button" aria-pressed={vault.autoLockMinutes === c} onClick={() => pick(c)}>{m.minutes(c)}</button>)}
      </div>
      <p class="small" role="status">{saved ? m.saved : ""}</p>
      <p class="error" role="alert">{error ?? ""}</p>
    </section>
  );
}
