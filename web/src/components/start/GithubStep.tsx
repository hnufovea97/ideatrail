import { COPY } from "../../lib/copy";
import type { StepProps } from "../../lib/signup/context";
import { stepNumber } from "../../lib/signup/machine";
import { Screen } from "../ui/Screen";
import { useGithubLink } from "./useGithubLink";

export function GithubStep({ api, ctx, state, dispatch }: StepProps) {
  const { phase, error, start } = useGithubLink(api, ctx, () => dispatch({ type: "github_done" }));
  return (
    <Screen step={stepNumber(state.step)} title={COPY.github.title} focusKey={phase} why={COPY.github.why} done={state.done} error={error}>
      {phase === "waiting" ? (
        <p aria-live="polite">{COPY.github.waiting}</p>
      ) : (
        <>
          <ol>{COPY.github.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          <button type="button" class="primary" onClick={start}>{COPY.github.action}</button>
          <button type="button" class="link" onClick={() => dispatch({ type: "github_later" })}>{COPY.github.later}</button>
        </>
      )}
    </Screen>
  );
}
