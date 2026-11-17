import { useEffect, useMemo, useState } from "preact/hooks";
import { API_BASE } from "../../config";
import { createApi, type RegisterOptions } from "../../lib/api";
import { prfSupport, type CapabilityEnv } from "../../lib/capability";
import { COPY, errorMessage } from "../../lib/copy";
import { joinOffer, receiveMasterKey, registerThisDevice, type Joined } from "../../lib/device-add";
import { clearFragment, parseConnectLink } from "../../lib/fragment";
import { POLL_MS } from "../../lib/timing";
import { createPasskey, forgetCredential, readPrf, type Created } from "../../lib/webauthn";
import { Screen } from "../ui/Screen";
import { usePolling } from "../ui/usePolling";

type Phase = "check" | "waiting" | "register" | "retry" | "done" | "stopped";

export default function ConnectApp() {
  const api = useMemo(() => createApi(API_BASE), []);
  const [phase, setPhase] = useState<Phase>("check");
  const [stop, setStop] = useState<string | null>(null);
  const [joined, setJoined] = useState<Joined | null>(null);
  const [key, setKey] = useState<{ userId: string; mk: Uint8Array } | null>(null);
  const [opts, setOpts] = useState<RegisterOptions | null>(null);
  const [pending, setPending] = useState<Created | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const halt = (text: string) => { setStop(text); setPhase("stopped"); };

  useEffect(() => {
    void (async () => {
      const link = parseConnectLink(location.search, location.hash);
      if (!link) return halt(COPY.stop.not_registered);
      clearFragment();
      if ((await prfSupport(window as unknown as CapabilityEnv)) === "no") return halt(COPY.stop.no_prf);
      try {
        setJoined(await joinOffer(api, link.d, link.qpsk));
        setPhase("waiting");
      } catch (e) {
        halt(errorMessage(e));
      }
    })();
  }, [api]);

  usePolling(phase === "waiting" && !!joined, POLL_MS, async () => {
    if (!joined) return true;
    try {
      const k = await receiveMasterKey(api, joined);
      if (!k) return false;
      setKey(k);
      setOpts(await api.registerOptions({ device_add_session_id: joined.d, join_secret: joined.joinSecret }));
      setPhase("register");
      return true;
    } catch (e) {
      halt(errorMessage(e));
      return true;
    }
  }, [joined]);

  const rpId = () => opts?.options.rp.id ?? location.hostname;

  async function finish(created: Created, prf: Uint8Array) {
    if (!opts || !key) return;
    try {
      await registerThisDevice(api, { challengeId: opts.challenge_id, userId: key.userId, mk: key.mk, created, prf });
      setKey(null);
      setPhase("done");
    } catch (e) {
      await forgetCredential(rpId(), created.rawId);
      setError(errorMessage(e));
      setPending(null);
      setPhase("register");
      if (joined) api.registerOptions({ device_add_session_id: joined.d, join_secret: joined.joinSecret }).then(setOpts, (e2) => setError(errorMessage(e2))); // a used challenge is never reused
    } finally {
      setBusy(false);
    }
  }

  function start() {
    if (!opts || busy) return;
    setBusy(true);
    setError(null);
    createPasskey(opts.options).then((c) => {
      if (c.prf) return finish(c, c.prf);
      setPending(c);
      setPhase("retry");
      setBusy(false);
    }, (e) => { setError(errorMessage(e)); setBusy(false); });
  }

  function retry() {
    if (!pending || busy) return;
    setBusy(true);
    readPrf(pending.rawId, opts?.options.rp.id).then(async (prf) => {
      if (prf) return finish(pending, prf);
      await forgetCredential(rpId(), pending.rawId);
      halt(COPY.stop.prf_missing);
    }, (e) => { setError(errorMessage(e)); setBusy(false); });
  }

  if (phase === "stopped") return <Screen title={stop ?? COPY.errors.generic} />;
  if (phase === "done") return <Screen title={COPY.connect.done}><p>{COPY.connect.a2hs}</p></Screen>;
  if (phase === "retry") {
    return <Screen title={COPY.pc.retryPrf} error={error}><button type="button" class="primary" onClick={retry} disabled={busy}>{COPY.pc.retryAction}</button></Screen>;
  }
  if (phase === "register") {
    return (
      <Screen title={COPY.connect.title} why={COPY.phone.why} error={error}>
        <button type="button" class="primary" onClick={start} disabled={!opts || busy}>{COPY.connect.action}</button>
      </Screen>
    );
  }
  return <Screen title={COPY.connect.title}><p aria-live="polite">{COPY.connect.waiting}</p></Screen>;
}
