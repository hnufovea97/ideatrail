import { useState } from "preact/hooks";
import type { Api } from "../../lib/api";
import { COPY } from "../../lib/copy";
import { MAX_NOTE_CHARS, sealNotes } from "../../lib/home/reminder";
import type { DashboardVault } from "../../lib/unlock";

/** `initial` is null when a saved note cannot be opened: say so, and let a new note replace it. */
interface Props { api: Api; vault: DashboardVault; initial: string | null; idPrefix: string; onSaved(text: string): void }

/** 기억 메모 (D8): one note of up to 500 characters, sealed here before it is sent; the server never sees the words. */
export function NoteEditor({ api, vault, initial, idPrefix, onSaved }: Props) {
  const m = COPY.note;
  const [text, setText] = useState(initial ?? "");
  const [state, setState] = useState<"idle" | "saved" | "failed">("idle");
  const [busy, setBusy] = useState(false);
  const length = [...text].length;
  const id = `${idPrefix}-note`;

  const save = () => {
    if (busy || length > MAX_NOTE_CHARS) return;
    setBusy(true);
    setState("idle");
    let sealed: string;
    try {
      sealed = sealNotes(vault.mk, vault.userId, text);
    } catch {
      setBusy(false);
      setState("failed");
      return;
    }
    void api.savePrefs({ recall_notes: sealed }).then(() => { setState("saved"); onSaved(text); }, () => setState("failed")).finally(() => setBusy(false));
  };

  return (
    <div class="note-editor">
      {initial === null ? <p class="error" role="alert">{m.unreadable}</p> : null}
      <label for={id}>{m.label}</label>
      <p class="small">{m.lock}</p>
      <textarea id={id} rows={4} value={text} autoComplete="off" spellcheck={false} aria-describedby={`${id}-hint`}
        onInput={(e) => { setText((e.target as HTMLTextAreaElement).value); setState("idle"); }} />
      <p class="small" id={`${id}-hint`}>{m.hint} · {m.count(length)}</p>
      <button type="button" disabled={busy || length > MAX_NOTE_CHARS} onClick={save}>{m.save}</button>
      <p class="small" role="status">{state === "saved" ? m.saved : ""}</p>
      <p class="error" role="alert">{state === "failed" ? m.failed : ""}</p>
    </div>
  );
}
