import { useEffect, useRef, useState } from "preact/hooks";
import type { Api } from "../../lib/api";
import { COPY } from "../../lib/copy";
import { clearPrivacyBlur } from "../../lib/blur";
import { browserStore } from "../../lib/engine-list";
import { externalOpenUrl, inAppBrowser } from "../../lib/inapp";
import { LOGIN_REFRESH_MS } from "../../lib/timing";
import { askPasskey, failureCode, isFresh, openVault, prepareLogin, settleOpened, unlockReason, type DashboardVault, type PreparedLogin } from "../../lib/unlock";
import { Screen } from "../ui/Screen";
import { RecoveryOpen } from "./RecoveryOpen";

interface Props { api: Api; notice: string | null; onOpen(v: DashboardVault): void }
/** Where the shown error came from: a later successful load clears only its own ("load"), never an open() failure. */
interface Shown { text: string; from: "load" | "open" }

/** Locked /home = the login screen (UX: two states only). Options are fetched before the click and kept fresh. */
export function LockScreen({ api, notice, onOpen }: Props) {
  const [prepared, setPrepared] = useState<PreparedLogin | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Shown | null>(null);
  const alive = useRef(true);
  const [recovering, setRecovering] = useState(false);
  const [made, setMade] = useState(false); // a new device lock was just made by 비상 열쇠로 열기

  const load = () => prepareLogin(api).then(
    (p) => {
      if (!alive.current) return;
      setPrepared(p);
      setError((e) => (e?.from === "load" ? null : e));
    },
    () => { if (alive.current) setError((e) => (e?.from === "open" ? e : { text: COPY.dash.errors.offline, from: "load" })); },
  );
  useEffect(() => {
    alive.current = true;
    void load();
    const t = setInterval(() => void load(), LOGIN_REFRESH_MS);
    const back = () => { if (document.visibilityState === "visible") void load(); }; // timers sleep in hidden tabs
    document.addEventListener("visibilitychange", back);
    window.addEventListener("pageshow", back);
    return () => {
      alive.current = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("pageshow", back);
    };
  }, [api]);

  const open = () => {
    if (!prepared || busy) return;
    if (!isFresh(prepared)) { // the server challenge is about to expire: fetch new options instead of a doomed get
      setPrepared(null);
      void load();
      return;
    }
    const asked = askPasskey(prepared); // first thing in the click: no await before get
    setBusy(true);
    setError(null);
    setPrepared(null); // a login challenge is single-use
    void asked.then(() => clearPrivacyBlur(document), () => clearPrivacyBlur(document)); // G2: no focus event after the sheet on Android
    void asked
      .then((got) => openVault(api, prepared, got, browserStore()))
      .then(
        (v) => settleOpened(alive.current, v, onOpen), // unmounted meanwhile: the keys are wiped, not dropped
        (e: unknown) => {
          if (!alive.current) return;
          const reason = unlockReason(e);
          const code = reason === "failed" ? ` (${COPY.dash.errorCode} ${failureCode(e)})` : "";
          setError({ text: COPY.dash.errors[reason] + code, from: "open" });
          setBusy(false);
          void load();
        },
      );
  };

  if (recovering) return <RecoveryOpen api={api} onBack={() => setRecovering(false)} onDone={() => { setMade(true); setRecovering(false); }} />;
  const inApp = typeof navigator === "undefined" ? null : inAppBrowser(navigator.userAgent);
  const outside = inApp ? externalOpenUrl(inApp, location.href) : null;
  return (
    <Screen title={COPY.dash.lockTitle} why={COPY.dash.lockLead} error={error?.text ?? null} status={busy ? COPY.dash.opening : made ? COPY.recoveryOpen.done : notice}>
      <button type="button" class="primary" onClick={open} disabled={!prepared || busy}>{COPY.dash.open}</button>
      <p class="small">{COPY.dash.openHint}</p>
      {inApp ? <p class="small" role="note">{COPY.dash.inApp[inApp]}</p> : null}
      <button type="button" class="link" onClick={() => { setMade(false); setRecovering(true); }}>{COPY.recoveryOpen.link}</button>
      {outside ? <a class="button" href={outside}>{inApp === "whale" ? COPY.dash.inApp.openChrome : COPY.dash.inApp.openOutside}</a> : null}
    </Screen>
  );
}
