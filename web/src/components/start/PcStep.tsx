import { useEffect, useState } from "preact/hooks";
import type { RegisterOptions } from "../../lib/api";
import { COPY, errorMessage } from "../../lib/copy";
import { browserStore } from "../../lib/engine-list";
import type { StepProps } from "../../lib/signup/context";
import { stepNumber } from "../../lib/signup/machine";
import type { Vault } from "../../lib/signup/account";
import { handOff, prepareAccount, submitAccount, verifyFailure, type PreparedAccount } from "../../lib/signup/pc-flow";
import { createPasskey, forgetCredential, readPrf, type Created } from "../../lib/webauthn";
import { Screen } from "../ui/Screen";

const isWindows = () => /Windows/.test(navigator.userAgent);

export function PcStep({ api, ctx, setCtx, state, dispatch }: StepProps) {
  const [opts, setOpts] = useState<RegisterOptions | null>(null);
  const [pending, setPending] = useState<Created | null>(null); // created, PRF still missing
  const [unsent, setUnsent] = useState<{ created: Created; prepared: PreparedAccount } | null>(null); // verify answer lost: maybe stored
  const [undelivered, setUndelivered] = useState<Vault | null>(null); // registered, handoff not done yet
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Options first, so the click can call create() with no await before it (QA B4).
  useEffect(() => {
    setOpts(null);
    api.registerOptions({ pairing_session_id: ctx.link.sessionId }).then(setOpts, (e) => setError(errorMessage(e)));
  }, [api, ctx.link.sessionId, attempt]);

  const rpId = () => opts?.options.rp.id ?? location.hostname;

  async function finish(created: Created, prf: Uint8Array) {
    if (!opts) return;
    let prepared: PreparedAccount;
    try {
      prepared = prepareAccount({ challengeId: opts.challenge_id, userId: opts.user_id, created, prf });
    } catch (e) {
      await forgetCredential(rpId(), created.rawId); // nothing was sent, so nothing refers to it
      setPending(null);
      setError(errorMessage(e));
      setAttempt((n) => n + 1);
      return;
    }
    await submit(created, prepared, false);
  }

  /** `unsure`: an earlier try of this same body may have reached the server, so never forget it now. */
  async function submit(created: Created, prepared: PreparedAccount, unsure: boolean) {
    let vault: Vault;
    try {
      vault = await submitAccount(api, prepared);
    } catch (e) {
      setPending(null);
      if (verifyFailure(e) === "unsure") {
        setUnsent({ created, prepared }); // keep the passkey and the vault; retry sends the same body
        setError(COPY.errors.verify_unsure);
        return;
      }
      if (!unsure) await forgetCredential(rpId(), created.rawId); // a definitive refusal: nothing refers to it
      setUnsent(null);
      setError(errorMessage(e));
      setAttempt((n) => n + 1);
      return;
    }
    setUnsent(null);
    setPending(null);
    await deliver(vault);
  }

  async function deliver(vault: Vault) {
    try {
      const engine = await handOff(api, ctx, vault, browserStore());
      setUndelivered(null);
      setCtx({ ...ctx, vault, engine });
      dispatch({ type: "pc_done" });
    } catch (e) {
      setUndelivered(vault); // registered already: retry only the handoff, never re-register
      setError(errorMessage(e));
    }
  }

  function fail(e: unknown) {
    setError(errorMessage(e));
    setAttempt((n) => n + 1); // a used or expired challenge is never reused
  }

  function start() {
    if (!opts || busy) return;
    setBusy(true);
    setError(null);
    createPasskey(opts.options)
      .then(async (created) => {
        if (created.prf) await finish(created, created.prf);
        else setPending(created);
      })
      .catch(fail)
      .finally(() => setBusy(false));
  }

  function retryPrf() {
    if (!pending || busy) return;
    setBusy(true);
    readPrf(pending.rawId, opts?.options.rp.id)
      .then(async (prf) => {
        if (prf) return finish(pending, prf);
        await forgetCredential(rpId(), pending.rawId); // never registered on the server
        dispatch({ type: "stop", reason: "prf_missing" });
      })
      .catch(fail)
      .finally(() => setBusy(false));
  }

  if (unsent) {
    const retry = () => { setBusy(true); setError(null); void submit(unsent.created, unsent.prepared, true).finally(() => setBusy(false)); };
    return (
      <Screen step={stepNumber(state.step)} title={COPY.pc.title} focusKey="unsent" done={state.done} error={error}>
        <button type="button" class="primary" onClick={retry} disabled={busy}>{COPY.actions.retry}</button>
      </Screen>
    );
  }
  if (undelivered) {
    const retry = () => { setBusy(true); void deliver(undelivered).finally(() => setBusy(false)); };
    return (
      <Screen step={stepNumber(state.step)} title={COPY.pc.title} focusKey="undelivered" done={state.done} error={error}>
        <button type="button" class="primary" onClick={retry} disabled={busy}>{COPY.actions.retry}</button>
      </Screen>
    );
  }
  if (pending) {
    return (
      <Screen step={stepNumber(state.step)} title={COPY.pc.retryPrf} done={state.done} error={error}>
        <button type="button" class="primary" onClick={retryPrf} disabled={busy}>{COPY.pc.retryAction}</button>
      </Screen>
    );
  }
  return (
    <Screen step={stepNumber(state.step)} title={COPY.pc.title} why={COPY.pc.why} done={state.done} error={error}>
      <p class="small">{COPY.pc.noSensor}</p>
      {isWindows() ? <p class="small">{COPY.pc.windows}</p> : null}
      <button type="button" class="primary" onClick={start} disabled={!opts || busy}>{COPY.pc.action}</button>
      <p class="small">{COPY.limit}</p>
    </Screen>
  );
}
