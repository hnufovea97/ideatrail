import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { API_BASE } from "../../config";
import { createApi } from "../../lib/api";
import { bindActivity, startAutoLock } from "../../lib/autolock";
import { bindPrivacyBlur } from "../../lib/blur";
import { COPY } from "../../lib/copy";
import { wipeVault, type DashboardVault } from "../../lib/unlock";
import { LockIcon } from "./LockIcon";
import { LockScreen } from "./LockScreen";
import { OpenShell } from "./OpenShell";

export default function DashboardApp() {
  const api = useMemo(() => createApi(API_BASE), []);
  const [vault, setVault] = useState<DashboardVault | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const opened = useRef(new AbortController()); // one per open vault; aborted by the lock

  useEffect(() => bindPrivacyBlur(window, document), []);

  const lock = useCallback((v: DashboardVault, idle: boolean) => {
    opened.current.abort(); // stop any refresh in flight before its keys turn to zeros
    wipeVault(v); // keys first; everything decrypted is dropped with the OpenShell state
    setVault(null);
    setNotice(idle ? COPY.dash.lockedIdle(v.autoLockMinutes) : null);
    void api.logout().catch(() => undefined); // best effort: the keys are already gone
  }, [api]);

  useEffect(() => {
    if (!vault) return;
    const auto = startAutoLock(vault.autoLockMinutes, () => lock(vault, true));
    const unbind = bindActivity(window, document, auto);
    const onHide = () => lock(vault, false);
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
        ? <OpenShell api={api} vault={vault} signal={opened.current.signal} onLock={() => lock(vault, false)} />
        : <LockScreen api={api} notice={notice} onOpen={(v) => { opened.current = new AbortController(); setNotice(null); setVault(v); }} />}
    </>
  );
}
