import { useState } from "preact/hooks";
import { COPY, didLine } from "../../lib/copy";
import type { StepProps } from "../../lib/signup/context";
import { Screen } from "../ui/Screen";
import { GithubBanner } from "./GithubBanner";

export function DoneStep({ api, ctx, state, dispatch }: StepProps) {
  const [closing, setClosing] = useState(false);
  const fresh = state.foldersChosen === 0;
  return (
    <Screen title={COPY.done.title} mark={COPY.done.mark} did={fresh ? null : didLine(state)}>
      {state.githubLater ? <GithubBanner api={api} ctx={ctx} onLinked={() => dispatch({ type: "github_done" })} /> : null}
      {state.done.phone ? <p>{COPY.done.phone}</p> : null}
      {fresh ? <p>{COPY.done.freshStart}</p> : null}
      <section data-testid="done-made" aria-labelledby="done-made-title">
        <h2 id="done-made-title">{COPY.done.madeTitle}</h2>
        <ul class="made">
          {COPY.done.made.map((m) => (
            <li key={m.key} class={state.done[m.key] ? "" : "not-yet"}>
              <span class="made-name">{m.name} · {m.where}{state.done[m.key] ? "" : ` (${COPY.done.notYet})`}</span>
              <span class="made-when">{m.when}</span>
            </li>
          ))}
        </ul>
      </section>
      <section data-testid="done-how" aria-labelledby="done-how-title">
        <h2 id="done-how-title">{COPY.done.how}</h2>
        <ol>{COPY.done.lines.map((l) => <li key={l}>{l}</li>)}</ol>
      </section>
      <section data-testid="done-next" aria-labelledby="done-next-title">
        <h2 id="done-next-title">{COPY.done.nextTitle}</h2>
        <ul>{COPY.done.next.map((l) => <li key={l}>{l}</li>)}</ul>
      </section>
      <button type="button" class="primary" onClick={() => { window.close(); setClosing(true); }}>{COPY.done.back}</button>
      <p class="small" aria-live="polite">{closing ? COPY.done.closeHint : ""}</p>
    </Screen>
  );
}
