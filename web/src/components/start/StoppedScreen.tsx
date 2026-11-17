import { COPY } from "../../lib/copy";
import type { StopReason } from "../../lib/signup/machine";
import { CopyButton } from "../ui/CopyButton";
import { Screen } from "../ui/Screen";

export function StoppedScreen({ reason, href }: { reason: StopReason; href: string | null }) {
  const action =
    reason === "no_link" ? <CopyButton text="/plugin install ideatrail" />
    : (reason === "no_prf" || reason === "prf_missing") && href ? <CopyButton text={href} label={COPY.actions.copyLink} />
    : null;
  return <Screen title={COPY.stop[reason]}>{action}</Screen>;
}
