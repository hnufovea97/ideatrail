import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { API_BASE } from "../../config";
import { createApi } from "../../lib/api";
import { bindActivity, startAutoLock } from "../../lib/autolock";
import { bindPrivacyBlur } from "../../lib/blur";
import { COPY } from "../../lib/copy";
import { wipeVault, type DashboardVault, type VaultPatch } from "../../lib/unlock";
import { LockIcon } from "./LockIcon";
import { LockScreen } from "./LockScreen";
import { OpenShell } from "./OpenShell";

export default function DashboardApp() {
  const api = useMemo(() => createApi(API_BASE), []);
  const [vault, setVault] = useState<DashboardVault | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const opened = useRef(new AbortController()); // one per open vault; aborted by the lock

  useEffect(() => bindPrivacyBlur(window, document), []);

  /** `closing`: from pagehide — the logout request must outlive the page (keepalive). */
  const lock = useCallback((v: DashboardVault, idle: boolean, closing = false) => {
    opened.current.abort(); // stop any refresh in flight before its keys turn to zeros
    wipeVault(v); // keys first; everything decrypted is dropped with the OpenShell state
    setVault(null);
    setNotice(idle ? COPY.dash.lockedIdle(v.autoLockMinutes) : null);
    void api.logout({ keepalive: closing }).catch(() => undefined); // best effort: the keys are already gone
  }, [api]);

  /** The account was deleted on the server: keys out of memory, back to the lock screen with one line. */
  const gone = useCallback((v: DashboardVault) => {
    opened.current.abort();
    wipeVault(v);
    setVault(null);
    setNotice(COPY.manage.account.notice);
  }, []);

  /** Patches the CURRENT vault, never a stale copy, and never one the lock has already closed (a locked vault stays locked). */
  const updateVault = useCallback((forUserId: string, patch: VaultPatch) => {
    setVault((cur) => (cur && !opened.current.signal.aborted && cur.userId === forUserId ? { ...cur, ...patch } : cur));
  }, []);

  useEffect(() => {
    if (!vault) return;
    const auto = startAutoLock(vault.autoLockMinutes, () => lock(vault, true));
    const unbind = bindActivity(window, document, auto);
    const onHide = () => lock(vault, false, true);
    window.addEventListener("pagehide", onHide);
    return () => {
      auto.stop();
      unbind();
      window.removeEventListener("pagehide", onHide);
    };
  }, [vault, lock]);

  return (
    <>
      <div class="blur-cover" aria-hidden="true"><LockIcon /><span class="sr-only">{COPY.dash.cover}</span></div>
      {vault
        ? <OpenShell api={api} vault={vault} signal={opened.current.signal} onLock={() => lock(vault, false)} onVault={(patch) => updateVault(vault.userId, patch)} onGone={() => gone(vault)} />
        : <LockScreen api={api} notice={notice} onOpen={(v) => { opened.current = new AbortController(); setNotice(null); setVault(v); }} />}
    </>
  );
}
