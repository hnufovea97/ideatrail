import { useEffect, useRef, useState } from "preact/hooks";
import type { Api } from "../../lib/api";
import { COPY } from "../../lib/copy";
import { browserStore } from "../../lib/engine-list";
import { LOGIN_REFRESH_MS } from "../../lib/timing";
import { askPasskey, openVault, prepareLogin, unlockReason, type DashboardVault, type PreparedLogin } from "../../lib/unlock";
import { Screen } from "../ui/Screen";

interface Props { api: Api; notice: string | null; onOpen(v: DashboardVault): void }

/** Locked /home = the login screen (UX: two states only). Options are fetched before the click. */
export function LockScreen({ api, notice, onOpen }: Props) {
  const [prepared, setPrepared] = useState<PreparedLogin | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const load = () => prepareLogin(api).then(
    (p) => { if (alive.current) setPrepared(p); },
    () => { if (alive.current) setError(COPY.dash.errors.offline); },
  );
  useEffect(() => {
    alive.current = true;
    void load();
    const t = setInterval(() => void load(), LOGIN_REFRESH_MS);
    return () => { alive.current = false; clearInterval(t); };
  }, [api]);

  const open = () => {
    if (!prepared || busy) return;
    const asked = askPasskey(prepared); // first thing in the click: no await before get
    setBusy(true);
    setError(null);
    setPrepared(null); // a login challenge is single-use
    void asked
      .then((got) => openVault(api, prepared, got, browserStore()))
      .then(
        (v) => { if (alive.current) onOpen(v); },
        (e: unknown) => {
          if (!alive.current) return;
          setError(COPY.dash.errors[unlockReason(e)]);
          setBusy(false);
          void load();
        },
      );
  };

  return (
    <Screen title={COPY.dash.lockTitle} why={COPY.dash.lockLead} error={error} status={busy ? COPY.dash.opening : notice}>
      <button type="button" class="primary" onClick={open} disabled={!prepared || busy}>{COPY.dash.open}</button>
      <p class="small">{COPY.dash.openHint}</p>
    </Screen>
  );
}
