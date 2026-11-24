import { useEffect, useState } from "preact/hooks";
import type { Api } from "../../lib/api";
import { dueCheck, openNotes, openReminder, sealReminder } from "../../lib/home/reminder";
import type { DashboardVault } from "../../lib/unlock";
import type { CheckData } from "./CheckCard";

/**
 * On opening the dashboard: read the account once and decide (D7). When the check is due the card is shown and the shown-at time is
 * saved right away, so it appears once; a failed save still shows it. Keyed on the user, so changing a setting does not run it again.
 */
export function useCheckCard(api: Api, vault: DashboardVault, signal: AbortSignal) {
  const [data, setData] = useState<CheckData | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const acct = await api.account();
      if (!live || signal.aborted || !acct.created_at) return;
      const now = new Date();
      if (!dueCheck(openReminder(vault.mk, vault.userId, acct.reminder_state), acct.created_at, now)) return;
      setData({ acct, notes: openNotes(vault.mk, vault.userId, acct.recall_notes) });
      try {
        await api.savePrefs({ reminder_state: sealReminder(vault.mk, vault.userId, { v: 1, shown_at: now.toISOString() }) });
      } catch {
        // shown anyway; it may come again at the next opening
      }
    })().catch(() => undefined); // no card is better than a broken page
    return () => { live = false; };
  }, [api, vault.userId, signal]);
  return { data, setNotes: (notes: string) => setData((d) => (d ? { ...d, notes } : d)), close: () => setData(null) };
}
