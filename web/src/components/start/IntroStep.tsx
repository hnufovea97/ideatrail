import { COPY } from "../../lib/copy";
import type { StepProps } from "../../lib/signup/context";
import { Screen } from "../ui/Screen";
import { IntroMap } from "./IntroMap";

export function IntroStep({ ctx, state, dispatch }: StepProps) {
  return (
    <Screen title={COPY.intro.title} done={state.done}>
      <p>{COPY.intro.what}</p>
      <p><strong>{COPY.intro.time}</strong></p>
      <IntroMap />
      <p><strong>{COPY.intro.computer(ctx.link.computerName)}</strong></p>
      <p class="small">{COPY.intro.warn}</p>
      <button type="button" class="primary" onClick={() => dispatch({ type: "begin" })}>{COPY.intro.action}</button>
    </Screen>
  );
}
