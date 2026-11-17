import { COPY } from "../../lib/copy";
import type { StepProps } from "../../lib/signup/context";
import { Screen } from "../ui/Screen";

export function IntroStep({ ctx, state, dispatch }: StepProps) {
  return (
    <Screen title={COPY.intro.title} done={state.done}>
      <p><strong>{COPY.intro.computer(ctx.link.computerName)}</strong></p>
      <p class="small">{COPY.intro.warn}</p>
      <p class="small">{COPY.limit}</p>
      <button type="button" class="primary" onClick={() => dispatch({ type: "begin" })}>{COPY.intro.action}</button>
    </Screen>
  );
}
