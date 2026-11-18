import { useEffect, useState } from "preact/hooks";
import { COPY, errorMessage } from "../../lib/copy";
import { firstFourMatches, makeRecovery, type RecoveryPlan } from "../../lib/recovery";
import type { StepProps } from "../../lib/signup/context";
import { canSkipRecovery, stepNumber } from "../../lib/signup/machine";
import { confirmWithPasskey, prepareStepup, type PreparedStepup } from "../../lib/stepup";
import { STEPUP_REFRESH_MS } from "../../lib/timing";
import { CopyButton } from "../ui/CopyButton";
import { Screen } from "../ui/Screen";

type Phase = "choose" | "show" | "check";

export function RecoveryStep({ api, ctx, state, dispatch }: StepProps) {
  const [phase, setPhase] = useState<Phase>("choose");
  const [method, setMethod] = useState<"manager" | "print">("manager");
  const [plan, setPlan] = useState<RecoveryPlan | null>(null);
  const [typed, setTyped] = useState("");
  const [prepared, setPrepared] = useState<PreparedStepup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mandatory = !canSkipRecovery(state);

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
        setPlan(null);
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
          <p class="key" data-testid="recovery-key">{plan.display}</p>
        </div>
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
          aria-describedby="first-four-help" value={typed} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} />
        <button type="button" class="primary" onClick={save} disabled={!prepared || busy}>{COPY.recovery.save}</button>
      </Screen>
    );
  }
  return (
    <Screen {...head} why={COPY.recovery.why}>
      <fieldset>
        <legend>{COPY.recovery.method}</legend>
        <label class="choice"><input type="radio" name="method" checked={method === "manager"} onChange={() => setMethod("manager")} /> {COPY.recovery.manager}</label>
        <label class="choice"><input type="radio" name="method" checked={method === "print"} onChange={() => setMethod("print")} /> {COPY.recovery.print}</label>
      </fieldset>
      <button type="button" class="primary" onClick={() => { setPlan(makeRecovery(vault)); setPhase("show"); }}>{COPY.recovery.make}</button>
      {mandatory ? null : <button type="button" class="link" onClick={() => dispatch({ type: "recovery_later" })}>{COPY.recovery.later}</button>}
    </Screen>
  );
}
