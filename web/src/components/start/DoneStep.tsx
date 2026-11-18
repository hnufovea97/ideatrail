import { useState } from "preact/hooks";
import { COPY } from "../../lib/copy";
import type { StepProps } from "../../lib/signup/context";
import { Screen } from "../ui/Screen";
import { GithubBanner } from "./GithubBanner";

export function DoneStep({ api, ctx, state, dispatch }: StepProps) {
  const [closing, setClosing] = useState(false);
  return (
    <Screen title={COPY.done.title} mark={COPY.done.mark}>
      {state.githubLater ? <GithubBanner api={api} ctx={ctx} onLinked={() => dispatch({ type: "github_done" })} /> : null}
      {state.done.phone ? <p>{COPY.done.phone}</p> : null}
      {state.foldersChosen === 0 ? <p>{COPY.done.freshStart}</p> : null}
      <section data-testid="done-how" aria-labelledby="done-how-title">
        <h2 id="done-how-title">{COPY.done.how}</h2>
        <ol>{COPY.done.lines.map((l) => <li key={l}>{l}</li>)}</ol>
      </section>
      <button type="button" class="primary" onClick={() => { window.close(); setClosing(true); }}>{COPY.done.back}</button>
      <p class="small" aria-live="polite">{closing ? COPY.done.closeHint : ""}</p>
    </Screen>
  );
}
