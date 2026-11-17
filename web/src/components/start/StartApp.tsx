import { useEffect, useMemo, useReducer, useState } from "preact/hooks";
import { API_BASE } from "../../config";
import { ApiFailure, createApi, type PairingInfo } from "../../lib/api";
import { prfSupport, type CapabilityEnv } from "../../lib/capability";
import { clearFragment, engineKeysMatch, parseStartLink } from "../../lib/fragment";
import type { SignupContext } from "../../lib/signup/context";
import { initialState, reduce, type StopReason } from "../../lib/signup/machine";
import { IntroStep } from "./IntroStep";
import { PcStep } from "./PcStep";
import { PhoneStep } from "./PhoneStep";
import { StoppedScreen } from "./StoppedScreen";

const PROTECT_STEPS = new Set(["phone", "github", "recovery", "folders"]);

function stopFor(e: unknown): StopReason {
  if (e instanceof ApiFailure && (e.status === 404 || e.status === 410)) return "link_expired";
  return "offline";
}

const Busy = () => <main class="screen" aria-busy="true"><p class="small">…</p></main>;

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
    })();
  }, [api]);

  useEffect(() => {
    if (!PROTECT_STEPS.has(state.step)) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [state.step]);

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
    default:
      return <Busy />;
  }
}
