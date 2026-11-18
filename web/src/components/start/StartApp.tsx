import { useEffect, useMemo, useReducer, useState } from "preact/hooks";
import { API_BASE } from "../../config";
import { ApiFailure, createApi, type PairingInfo } from "../../lib/api";
import { prfSupport, type CapabilityEnv } from "../../lib/capability";
import { clearFragment, engineKeysMatch, parseStartLink } from "../../lib/fragment";
import type { SignupContext } from "../../lib/signup/context";
import { COPY } from "../../lib/copy";
import { initialState, reduce, type StopReason } from "../../lib/signup/machine";
import { DoneStep } from "./DoneStep";
import { FoldersStep } from "./FoldersStep";
import { GithubStep } from "./GithubStep";
import { IntroStep } from "./IntroStep";
import { PcStep } from "./PcStep";
import { PhoneStep } from "./PhoneStep";
import { RecoveryStep } from "./RecoveryStep";
import { StoppedScreen } from "./StoppedScreen";

const PROTECT_STEPS = new Set(["phone", "github", "recovery", "folders"]);
/** Warn before leaving while keys live only in this tab: steps 2–5, and step 1 once a vault exists. */
const shouldProtect = (step: string, hasVault: boolean) => PROTECT_STEPS.has(step) || (step === "pc" && hasVault);

function stopFor(e: unknown): StopReason {
  if (e instanceof ApiFailure && (e.status === 404 || e.status === 410)) return "link_expired";
  return "offline";
}

const Busy = () => <main class="screen" aria-busy="true"><p class="small" role="status">{COPY.busy}</p></main>;

export default function StartApp() {
  const api = useMemo(() => createApi(API_BASE), []);
  const [state, dispatch] = useReducer(reduce, initialState);
  const [ctx, setCtx] = useState<SignupContext | null>(null);
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const original = location.href;
      const link = parseStartLink(location.search, location.hash);
      if (!link) return dispatch({ type: "stop", reason: "no_link" });
      clearFragment();
      setHref(original);
      if ((await prfSupport(window as unknown as CapabilityEnv)) === "no") return dispatch({ type: "stop", reason: "no_prf" });
      let info: PairingInfo;
      try {
        info = await api.pairing(link.sessionId);
      } catch (e) {
        return dispatch({ type: "stop", reason: stopFor(e) });
      }
      if (info.delivered) return dispatch({ type: "stop", reason: "link_used" });
      const keys = await engineKeysMatch(link, info);
      if (!keys) return dispatch({ type: "stop", reason: "link_mismatch" }); // spec §9-3: nothing else is sent
      setCtx({ link, href: original, info, signPub: keys.signPub, kemPub: keys.kemPub, vault: null, engine: null });
      dispatch({ type: "checked" });
    })().catch(() => dispatch({ type: "stop", reason: "failed" })); // anything unexpected stops here
  }, [api]);

  const hasVault = !!ctx?.vault;
  useEffect(() => {
    if (!shouldProtect(state.step, hasVault)) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [state.step, hasVault]);

  // The end: drop the keys and the link from memory. The GitHub banner still needs the vault until it links.
  useEffect(() => {
    if (state.step !== "done" || state.githubLater) return;
    setCtx((c) => (c && (c.vault || c.href) ? { ...c, vault: null, href: null } : c));
    setHref(null);
  }, [state.step, state.githubLater]);

  if (state.step === "stopped" && state.stop) return <StoppedScreen reason={state.stop} href={href} />;
  if (!ctx) return <Busy />;
  const props = { api, ctx, setCtx, state, dispatch };
  switch (state.step) {
    case "intro":
      return <IntroStep {...props} />;
    case "pc":
      return <PcStep {...props} />;
    case "phone":
      return <PhoneStep {...props} />;
    case "github":
      return <GithubStep {...props} />;
    case "recovery":
      return <RecoveryStep {...props} />;
    case "folders":
      return <FoldersStep {...props} />;
    case "done":
      return <DoneStep {...props} />;
    default:
      return <Busy />;
  }
}
