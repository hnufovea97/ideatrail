import { useEffect, useRef, useState } from "preact/hooks";
import type { Api } from "../../lib/api";
import { prfSupport, type CapabilityEnv } from "../../lib/capability";
import { COPY } from "../../lib/copy";
import { inAppBrowser } from "../../lib/inapp";
import { abandonRecovery, finishRecovery, lockCreateError, recoveryReason, startRecovery, type RecoveryState } from "../../lib/recovery-open";
import { verifyFailure } from "../../lib/signup/pc-flow";
import { RECOVERY_HOLD_MS } from "../../lib/timing";
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
    const onHide = () => { if (state.current) abandonRecovery(state.current); }; // the page is leaving: the key goes with it
    window.addEventListener("pagehide", onHide);
    const inApp = inAppBrowser(navigator.userAgent);
    if (inApp) setBlocked(COPY.dash.inApp[inApp]);
    void prfSupport(window as unknown as CapabilityEnv).then((s) => { if (s === "no" && alive.current) setBlocked(COPY.stop.no_prf); });
    return () => {
      alive.current = false;
      window.removeEventListener("pagehide", onHide);
      if (state.current) abandonRecovery(state.current); // the opened key never outlives this screen
      state.current = null;
    };
  }, []);

  const rpId = () => state.current?.options.options.rp.id ?? location.hostname;
  /** Back to the key input: the opened key is wiped first, never just dropped. */
  const restart = (text: string) => {
    if (state.current) abandonRecovery(state.current);
    state.current = null;
    setPending(null);
    setPhase("input");
    setError(text);
  };

  // The opened key does not wait for ever: after 5 minutes on the lock step it is wiped and the typing starts over.
  useEffect(() => {
    if (phase === "input" || busy) return;
    const t = setTimeout(() => {
      if (pending) void forgetCredential(rpId(), pending.rawId); // made but never registered
      restart(m.errors.expired);
    }, RECOVERY_HOLD_MS);
    return () => clearTimeout(t);
  }, [phase, busy, pending]);

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
    const rp = s.options.options.rp.id ?? location.hostname;
    createPasskey(s.options.options)
      .then((c) => {
        if (!alive.current) return forgetCredential(rp, c.rawId); // the screen is gone: nothing will register it
        if (c.prf) return finish(c, c.prf);
        setPending(c);
        setPhase("retry");
      })
      .catch((e: unknown) => { if (alive.current) setError(lockCreateError(e)); })
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
      .catch((e: unknown) => { if (alive.current) setError(lockCreateError(e)); })
      .finally(() => { if (alive.current) setBusy(false); });
  };

  if (blocked) {
    return <Screen title={m.title} error={blocked}><button type="button" onClick={onBack}>{m.back}</button></Screen>;
  }
  if (phase === "retry") {
    return <Screen title={COPY.pc.retryPrf} focusKey="retry" why={COPY.pc.retryWhy} error={error}><button type="button" class="primary" onClick={retry} disabled={busy}>{COPY.pc.retryAction}</button></Screen>;
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
