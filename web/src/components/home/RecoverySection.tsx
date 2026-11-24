import { useState } from "preact/hooks";
import type { Api } from "../../lib/api";
import { COPY, errorMessage } from "../../lib/copy";
import { shortDate } from "../../lib/home/format";
import { firstFourMatches, makeRecovery, type RecoveryPlan } from "../../lib/recovery";
import type { DashboardVault } from "../../lib/unlock";
import { groups } from "../start/RecoveryStep";
import { CopyButton } from "../ui/CopyButton";
import { useStepup } from "../ui/useStepup";

type Phase = "idle" | "show" | "check";
interface Props { api: Api; vault: DashboardVault; madeAt: string | null; onSaved(): void }

/** 비상 열쇠: make or re-make. The key is shown once, checked in the browser (first four only), then saved with step-up. */
export function RecoverySection({ api, vault, madeAt, onSaved }: Props) {
  const m = COPY.manage.recovery;
  const r = COPY.recovery;
  const [phase, setPhase] = useState<Phase>("idle");
  const [plan, setPlan] = useState<RecoveryPlan | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const step = useStepup(api, "PUT", phase === "check" ? "/v1/envelopes" : null);

  const save = () => {
    if (!plan || busy) return;
    if (!firstFourMatches(plan.display, typed)) return setError(COPY.manage.errors.mismatch); // no request at all
    const asked = step.take();
    if (!asked) return;
    setBusy(true);
    setError(null);
    void asked.then((assertion) => api.putRecovery({ ...plan.body, assertion })).then(() => {
      setPlan(null); // the key is not kept once saved
      setTyped("");
      setPhase("idle");
      setBusy(false);
      onSaved();
    }, (e: unknown) => { setError(errorMessage(e)); setBusy(false); });
  };

  return (
    <section aria-labelledby="recovery-title">
      <h2 id="recovery-title">{m.title}</h2>
      <p class="small">{madeAt ? m.made(shortDate(madeAt)) : m.none}</p>
      {phase === "idle" ? (
        <>
          {madeAt ? <p class="small">{m.remakeNote}</p> : null}
          <button type="button" onClick={() => { setPlan(makeRecovery(vault)); setPhase("show"); }}>{madeAt ? m.remake : m.make}</button>
        </>
      ) : null}
      {phase === "show" && plan ? (
        <>
          <div class="print-sheet">
            <p>{r.sheetTitle}</p>
            <p class="key" data-testid="settings-recovery-key">{groups(plan.display)}</p>
          </div>
          <p class="small">{r.readHint}</p>
          <CopyButton text={plan.display} label={r.copy} />
          <button type="button" class="primary" onClick={() => setPhase("check")}>{r.wrote}</button>
        </>
      ) : null}
      {phase === "check" && plan ? (
        <>
          <label for="settings-first-four">{r.firstFour}</label>
          <p class="small">{r.firstFourHelp}</p>
          <input id="settings-first-four" type="text" maxLength={6} autoComplete="off" spellcheck={false} autoCapitalize="characters" value={typed} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} />
          <p class="small">{r.saveAhead}</p>
          <button type="button" class="primary" disabled={!step.ready || busy} onClick={save}>{r.save}</button>
        </>
      ) : null}
      <p class="error" role="alert">{error ?? ""}</p>
    </section>
  );
}
