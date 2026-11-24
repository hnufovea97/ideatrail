import { useState } from "preact/hooks";
import { STAGE_PRESETS, COPY } from "../../lib/copy";
import { validStageName } from "../../lib/merge/stages";

interface Props { names: readonly string[]; onSave(names: readonly string[]): Promise<void>; onClose(): void }

/** Five boxes for the stage names (ADR-0020). Save stays off until every box is a good name; names are only sent sealed. */
export function StageRename({ names, onSave, onClose }: Props) {
  const r = COPY.life.rename;
  const [values, setValues] = useState<readonly string[]>(names);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ok = values.every(validStageName);

  const send = async (next: readonly string[]) => {
    setBusy(true);
    setFailed(false);
    try {
      await onSave(next);
      onClose();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <form class="rename" onSubmit={(e) => { e.preventDefault(); if (ok && !busy) void send(values); }}>
      <h3>{r.title}</h3>
      <p class="small">{r.note}</p>
      <div class="rename-fields">
        {values.map((v, i) => (
          <label key={i}>
            <span class="sr-only">{r.field(i + 1)}</span>
            <input type="text" value={v} aria-label={r.field(i + 1)} aria-invalid={validStageName(v) ? undefined : "true"} autocomplete="off"
              onInput={(e) => setValues(values.map((x, j) => (j === i ? e.currentTarget.value : x)))} />
          </label>
        ))}
      </div>
      <p class="small">{r.rule}</p>
      {failed ? <p class="small" role="alert">{r.failed}</p> : null}
      <p class="rename-actions">
        <button type="submit" class="primary" disabled={!ok || busy}>{r.save}</button>
        <button type="button" class="link" disabled={busy} onClick={() => void send(STAGE_PRESETS.build)}>{r.reset}</button>
        <button type="button" class="link" disabled={busy} onClick={onClose}>{r.cancel}</button>
      </p>
    </form>
  );
}
