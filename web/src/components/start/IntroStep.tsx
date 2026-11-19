import { COPY } from "../../lib/copy";
import type { StepProps } from "../../lib/signup/context";
import { Screen } from "../ui/Screen";
import { IntroMap } from "./IntroMap";
import { IntroPitch } from "./IntroPitch";

export function IntroStep({ ctx, dispatch }: StepProps) {
  return (
    <Screen title={COPY.intro.title}>
      <p class="lead">{COPY.intro.what}</p>
      <IntroPitch />
      <IntroMap />
      <p><strong>{COPY.intro.time}</strong></p>
      <p><strong>{COPY.intro.computer(ctx.link.computerName)}</strong></p>
      <p class="small">{COPY.intro.warn}</p>
      <button type="button" class="primary" onClick={() => dispatch({ type: "begin" })}>{COPY.intro.action}</button>
    </Screen>
  );
}
