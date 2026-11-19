import { COPY } from "../../lib/copy";
import type { StopReason } from "../../lib/signup/machine";
import { CopyButton } from "../ui/CopyButton";
import { Screen } from "../ui/Screen";

export function StoppedScreen({ reason, href }: { reason: StopReason; href: string | null }) {
  if (reason === "no_link") {
    return (
      <Screen title={COPY.stop.no_link} why={COPY.noLink.why}>
        <p class="small">{COPY.noLink.install}</p>
        <CopyButton text="/plugin install ideatrail" label={COPY.actions.copyCommand} />
      </Screen>
    );
  }
  const action = (reason === "no_prf" || reason === "prf_missing") && href ? <CopyButton text={href} label={COPY.actions.copyLink} /> : null;
  return <Screen title={COPY.stop[reason]}>{action}</Screen>;
}
