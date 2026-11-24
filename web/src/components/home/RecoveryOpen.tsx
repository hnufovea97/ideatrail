import { useEffect, useRef, useState } from "preact/hooks";
import type { Api } from "../../lib/api";
import { prfSupport, type CapabilityEnv } from "../../lib/capability";
import { COPY } from "../../lib/copy";
import { inAppBrowser } from "../../lib/inapp";
import { abandonRecovery, finishRecovery, recoveryReason, startRecovery, type RecoveryState } from "../../lib/recovery-open";
import { verifyFailure } from "../../lib/signup/pc-flow";
import { createPasskey, forgetCredential, readPrf, type Created } from "../../lib/webauthn";
import { Screen } from "../ui/Screen";

type Phase = "input" | "ready" | "retry";
interface Props { api: Api; onBack(): void; onDone(): void }

/** 비상 열쇠로 열기: the typed key opens the sealed key here, then a new device lock is made; the normal lock screen opens it (D10). */
export function RecoveryOpen({ api, onBack, onDone }: Props) {
  const m = COPY.recoveryOpen;
  const [phase, setPhase] = useState<Phase>("input");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [pending, setPending] = useState<Created | null>(null);
  const state = useRef<RecoveryState | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const inApp = inAppBrowser(navigator.userAgent);
    if (inApp) setBlocked(COPY.dash.inApp[inApp]);
    void prfSupport(window as unknown as CapabilityEnv).then((s) => { if (s === "no" && alive.current) setBlocked(COPY.stop.no_prf); });
    return () => {
      alive.current = false;
      if (state.current) abandonRecovery(state.current); // the opened key never outlives this screen
      state.current = null;
    };
  }, []);

  const rpId = () => state.current?.options.options.rp.id ?? location.hostname;
  const restart = (text: string) => { state.current = null; setPending(null); setPhase("input"); setError(text); };

  const check = () => {
    if (busy || !typed.trim()) return;
    setBusy(true);
    setError(null);
    startRecovery(api, typed).then((s) => {
      if (!alive.current) return abandonRecovery(s);
      state.current = s;
      setTyped(""); // the key leaves the screen as soon as it has done its work
      setPhase("ready");
    }, (e: unknown) => { if (alive.current) setError(m.errors[recoveryReason(e)]); }).finally(() => { if (alive.current) setBusy(false); });
  };

  const finish = async (created: Created, prf: Uint8Array) => {
    const s = state.current;
    if (!s) return;
    try {
      await finishRecovery(api, s, created, prf);
      state.current = null;
      if (alive.current) onDone();
    } catch (e) {
      if (verifyFailure(e) === "refused") await forgetCredential(rpId(), created.rawId); // an answer lost on the way keeps it
      if (alive.current) restart(m.errors[recoveryReason(e)]);
    }
  };

  /** Straight from the click: no await before create (Safari). */
  const makeLock = () => {
    const s = state.current;
    if (!s || busy) return;
    setBusy(true);
    setError(null);
    createPasskey(s.options.options)
      .then((c) => {
        if (c.prf) return finish(c, c.prf);
        setPending(c);
        setPhase("retry");
      })
      .catch((e: unknown) => { if (alive.current) setError(e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError") ? COPY.errors.passkey_cancel : COPY.errors.generic); })
      .finally(() => { if (alive.current) setBusy(false); });
  };

  const retry = () => {
    if (!pending || busy) return;
    setBusy(true);
    readPrf(pending.rawId, state.current?.options.options.rp.id)
      .then(async (prf) => {
        if (prf) return finish(pending, prf);
        await forgetCredential(rpId(), pending.rawId);
        restart(COPY.stop.prf_missing);
      })
      .catch(() => { if (alive.current) setError(COPY.errors.generic); })
      .finally(() => { if (alive.current) setBusy(false); });
  };

  if (blocked) {
    return <Screen title={m.title} error={blocked}><button type="button" onClick={onBack}>{m.back}</button></Screen>;
  }
  if (phase === "retry") {
    return <Screen title={COPY.pc.retryPrf} why={COPY.pc.retryWhy} error={error}><button type="button" class="primary" onClick={retry} disabled={busy}>{COPY.pc.retryAction}</button></Screen>;
  }
  if (phase === "ready") {
    return (
      <Screen title={m.ready} focusKey="ready" error={error}>
        <p class="small">{m.ahead}</p>
        <button type="button" class="primary" onClick={makeLock} disabled={busy}>{m.action}</button>
      </Screen>
    );
  }
  return (
    <Screen title={m.title} why={m.why} error={error} status={busy ? m.checking : null}>
      <label for="recovery-input">{m.label}</label>
      <p class="small" id="recovery-hint">{m.hint}</p>
      <input id="recovery-input" type="text" inputMode="text" autoComplete="off" spellcheck={false} autoCapitalize="characters" maxLength={80}
        aria-describedby="recovery-hint" aria-invalid={error ? "true" : undefined} aria-errormessage={error ? "screen-error" : undefined}
        value={typed} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === "Enter") check(); }} />
      <button type="button" class="primary" onClick={check} disabled={busy || !typed.trim()}>{m.open}</button>
      <button type="button" class="link" onClick={onBack}>{m.back}</button>
    </Screen>
  );
}
