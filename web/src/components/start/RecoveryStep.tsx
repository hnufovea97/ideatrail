import { useEffect, useState } from "preact/hooks";
import { COPY, didLine, errorMessage } from "../../lib/copy";
import { firstFourMatches, makeRecovery, type RecoveryPlan } from "../../lib/recovery";
import type { StepProps } from "../../lib/signup/context";
import { canSkipRecovery, stepNumber } from "../../lib/signup/machine";
import { confirmWithPasskey, prepareStepup, type PreparedStepup } from "../../lib/stepup";
import { STEPUP_REFRESH_MS } from "../../lib/timing";
import { CopyButton } from "../ui/CopyButton";
import { ERROR_ID, Screen } from "../ui/Screen";

type Phase = "choose" | "show" | "check";

/** One span per group (the hyphen stays with it, so the text is the key as written); never translated. */
const groups = (display: string) => {
  const parts = display.split("-");
  return parts.map((g, i) => <span key={i} translate={false} lang="en">{i < parts.length - 1 ? `${g}-` : g}</span>);
};

export function RecoveryStep({ api, ctx, state, dispatch }: StepProps) {
  const [phase, setPhase] = useState<Phase>("choose");
  const [method, setMethod] = useState<"manager" | "print">("manager");
  const [plan, setPlan] = useState<RecoveryPlan | null>(null);
  const [typed, setTyped] = useState("");
  const [prepared, setPrepared] = useState<PreparedStepup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mandatory = !canSkipRecovery(state);
  const mismatch = error === COPY.recovery.mismatch;

  // The step-up challenge is fetched before the click, and renewed before it expires.
  useEffect(() => {
    if (phase !== "check") return;
    const load = () => prepareStepup(api, "PUT", "/v1/envelopes").then(setPrepared, (e) => setError(errorMessage(e)));
    void load();
    const t = setInterval(load, STEPUP_REFRESH_MS);
    return () => clearInterval(t);
  }, [phase, api]);

  const vault = ctx.vault;
  if (!vault) return null;
  const head = { step: stepNumber(state.step), title: COPY.recovery.title, focusKey: phase, badge: COPY.recovery.badge, done: state.done, error };

  function save() {
    if (!plan || !prepared || busy) return;
    if (!firstFourMatches(plan.display, typed)) return setError(COPY.recovery.mismatch); // no request at all
    setBusy(true);
    setError(null);
    confirmWithPasskey(prepared)
      .then((assertion) => api.putRecovery({ ...plan.body, assertion }))
      .then(() => {
        setPlan(null); // the key is not kept once it is saved
        setTyped("");
        dispatch({ type: "recovery_done" });
      }, (e) => {
        setError(errorMessage(e));
        setPrepared(null);
        void prepareStepup(api, "PUT", "/v1/envelopes").then(setPrepared, () => undefined);
        setBusy(false);
      });
  }

  if (phase === "show" && plan) {
    return (
      <Screen {...head}>
        <div class="print-sheet">
          <p>{COPY.recovery.sheetTitle}</p>
          <p class="key" data-testid="recovery-key">{groups(plan.display)}</p>
        </div>
        <p class="small">{COPY.recovery.readHint}</p>
        <p class="ahead">{method === "manager" ? COPY.recovery.copyAhead : COPY.recovery.printAhead}</p>
        {method === "manager" ? <CopyButton text={plan.display} label={COPY.recovery.copy} /> : <button type="button" onClick={() => window.print()}>{COPY.recovery.printAction}</button>}
        <button type="button" class="primary" onClick={() => setPhase("check")}>{COPY.recovery.wrote}</button>
      </Screen>
    );
  }
  if (phase === "check" && plan) {
    return (
      <Screen {...head}>
        <label for="first-four">{COPY.recovery.firstFour}</label>
        <p class="small" id="first-four-help">{COPY.recovery.firstFourHelp}</p>
        <input id="first-four" type="text" inputMode="text" maxLength={6} autoComplete="off" spellcheck={false} autoCapitalize="characters"
          aria-describedby="first-four-help" aria-invalid={mismatch ? "true" : undefined} aria-errormessage={mismatch ? ERROR_ID : undefined} value={typed} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} />
        <p class="ahead">{COPY.recovery.saveAhead}</p>
        <button type="button" class="primary" onClick={save} disabled={!prepared || busy}>{COPY.recovery.save}</button>
      </Screen>
    );
  }
  return (
    <Screen {...head} did={didLine(state)} why={COPY.recovery.why}>
      <fieldset>
        <legend>{COPY.recovery.method}</legend>
        <label class="choice"><input type="radio" name="method" aria-describedby="method-manager-help" checked={method === "manager"} onChange={() => setMethod("manager")} /> {COPY.recovery.manager}</label>
        <p class="small choice-help" id="method-manager-help">{COPY.recovery.managerHelp}</p>
        <label class="choice"><input type="radio" name="method" aria-describedby="method-print-help" checked={method === "print"} onChange={() => setMethod("print")} /> {COPY.recovery.print}</label>
        <p class="small choice-help" id="method-print-help">{COPY.recovery.printHelp}</p>
      </fieldset>
      <p class="ahead">{COPY.recovery.ahead}</p>
      <button type="button" class="primary" onClick={() => { setPlan(makeRecovery(vault)); setPhase("show"); }}>{COPY.recovery.make}</button>
      {mandatory ? null : <button type="button" class="link" onClick={() => dispatch({ type: "recovery_later" })}>{COPY.recovery.later}</button>}
    </Screen>
  );
}
