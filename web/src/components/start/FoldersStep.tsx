import { useEffect, useRef, useState } from "preact/hooks";
import type { ApprovalRow } from "../../lib/api";
import { COPY, errorMessage } from "../../lib/copy";
import { buildDecision, initialSelection, openSuggestions, planImport, signupApproval, type SuggestedFolder } from "../../lib/folders";
import type { StepProps } from "../../lib/signup/context";
import { stepNumber } from "../../lib/signup/machine";
import { confirmWithPasskey, prepareStepup, type PreparedStepup } from "../../lib/stepup";
import { FOLDERS_WAIT_MS, POLL_MS, STEPUP_REFRESH_MS } from "../../lib/timing";
import { Screen } from "../ui/Screen";
import { usePolling } from "../ui/usePolling";

export function FoldersStep({ api, ctx, state, dispatch }: StepProps) {
  const [phase, setPhase] = useState<"waiting" | "choose" | "timeout">("waiting");
  const [row, setRow] = useState<ApprovalRow | null>(null);
  const [folders, setFolders] = useState<SuggestedFolder[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [prepared, setPrepared] = useState<PreparedStepup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(Date.now());
  const { vault, engine } = ctx;

  usePolling(phase === "waiting" && !!vault && !!engine, POLL_MS, async () => {
    if (!vault || !engine) return true;
    try {
      const found = signupApproval((await api.approvals()).approvals, engine, vault.userId);
      if (found) {
        const fs = await openSuggestions(vault, found);
        setRow(found);
        setFolders(fs);
        setSelected(initialSelection(fs));
        setPhase("choose");
        return true;
      }
      if (Date.now() - started.current > FOLDERS_WAIT_MS) {
        setPhase("timeout");
        return true;
      }
      return false;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  }, [phase]);

  useEffect(() => {
    if (!row) return;
    const load = () => prepareStepup(api, "POST", `/v1/approvals/${row.approval_id}/decide`).then(setPrepared, (e) => setError(errorMessage(e)));
    void load();
    const t = setInterval(load, STEPUP_REFRESH_MS);
    return () => clearInterval(t);
  }, [row, api]);

  if (!vault || !engine) return null;
  const head = { step: stepNumber(state.step), title: COPY.folders.title, why: COPY.folders.why, done: state.done, error };

  const toggle = (path: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });

  function submit() {
    if (!row || !prepared || busy || !vault) return;
    setBusy(true);
    setError(null);
    const chosen = folders.filter((f) => selected.has(f.path)).map((f) => f.path);
    confirmWithPasskey(prepared)
      .then(async (assertion) => {
        const d = await buildDecision(vault, ctx.kemPub, row.approval_id, chosen);
        await api.decide(row.approval_id, { ...d, assertion });
        dispatch({ type: "folders_done", count: chosen.length });
      })
      .catch((e: unknown) => {
        setError(errorMessage(e));
        setPrepared(null);
        void prepareStepup(api, "POST", `/v1/approvals/${row.approval_id}/decide`).then(setPrepared, () => undefined);
        setBusy(false);
      });
  }

  if (phase === "waiting") return <Screen {...head}><p aria-live="polite">{COPY.folders.waiting}</p></Screen>;
  if (phase === "timeout") {
    return (
      <Screen {...head} error={COPY.folders.timeout}>
        <button type="button" onClick={() => { started.current = Date.now(); setPhase("waiting"); }}>{COPY.folders.retry}</button>
      </Screen>
    );
  }
  const plan = planImport(folders, selected);
  return (
    <Screen {...head}>
      <fieldset>
        <legend class="sr-only">{COPY.folders.title}</legend>
        {folders.map((f) => (
          <label class="choice" key={f.path}>
            <input type="checkbox" checked={selected.has(f.path)} onChange={() => toggle(f.path)} />
            {f.current ? `${COPY.folders.current} · ${f.name}` : f.name} ({COPY.folders.files(f.files)})
          </label>
        ))}
      </fieldset>
      {selected.size === 0 ? <p class="small">{COPY.folders.noneNote}</p> : null}
      {plan.later > 0 ? <p class="small">{COPY.folders.split(plan.later)}</p> : null}
      <button type="button" class="primary" onClick={submit} disabled={!prepared || busy}>{selected.size === 0 ? COPY.folders.none : COPY.folders.action}</button>
    </Screen>
  );
}
