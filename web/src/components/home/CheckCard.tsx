import { useState } from "preact/hooks";
import type { Api } from "../../lib/api";
import { COPY } from "../../lib/copy";
import { shortDate } from "../../lib/home/format";
import { checkRows, type CheckRows } from "../../lib/home/reminder";
import type { AccountInfo } from "../../lib/api";
import type { DashboardVault } from "../../lib/unlock";
import { NoteEditor } from "./NoteEditor";

export interface GithubTool { phase: "idle" | "waiting"; error: string | null; start(): Promise<void> }
export interface CheckData { acct: AccountInfo; notes: string | null }
interface Props {
  api: Api; vault: DashboardVault; signal: AbortSignal; data: CheckData; githubLinked: boolean; github: GithubTool; showShortcut: boolean;
  onMakeKey(): void; onNotes(text: string): void; onClose(): void;
}

/** 챙길 것 카드 (UX ⑥-3): the status of each thing is read from the account, never typed. [괜찮아요] only closes it. */
export function CheckCard({ api, vault, signal, data, githubLinked, github, showShortcut, onMakeKey, onNotes, onClose }: Props) {
  const c = COPY.check;
  const rows: CheckRows = checkRows(data.acct, githubLinked);
  const [noting, setNoting] = useState(false);
  const [how, setHow] = useState(false);
  return (
    <section class="panel check-card" aria-labelledby="check-title">
      <h2 id="check-title">{c.title}</h2>
      <ul class="check-rows">
        <li>
          <p><strong>{c.recovery.label}</strong> <span class="badge">{COPY.recovery.badge}</span> · {rows.recovery.madeAt ? c.recovery.made(shortDate(rows.recovery.madeAt)) : c.recovery.none}</p>
          {rows.recovery.madeAt ? null : <button type="button" onClick={onMakeKey}>{c.recovery.make}</button>}
        </li>
        <li>
          <p><strong>{c.devices.label(rows.devices.count)}</strong>{rows.devices.places.length ? ` · ${rows.devices.places.join(" · ")}` : ""}</p>
          {rows.devices.count <= 1 ? <p class="small">{c.devices.one}</p> : null}
        </li>
        <li>
          <p><strong>{c.github.label}</strong> · {rows.github ? c.github.on : c.github.off}</p>
          {rows.github ? null : <button type="button" disabled={github.phase === "waiting"} onClick={() => void github.start()}>{c.github.connect}</button>}
          {github.phase === "waiting" ? <p class="small" role="status">{c.github.waiting}</p> : null}
          {github.error ? <p class="error" role="alert">{github.error}</p> : null}
        </li>
        {showShortcut ? (
          <li>
            <p><strong>{c.shortcut.label}</strong> · {c.shortcut.off}</p>
            <button type="button" aria-expanded={how} onClick={() => setHow(!how)}>{c.shortcut.how}</button>
            {how ? <p class="small">{c.shortcut.steps}</p> : null}
          </li>
        ) : null}
      </ul>
      {noting ? <NoteEditor api={api} vault={vault} signal={signal} initial={data.notes} idPrefix="check" onSaved={onNotes} /> : null}
      <div class="row-actions">
        {noting ? null : <button type="button" onClick={() => setNoting(true)}>{COPY.note.open}</button>}
        <button type="button" class="primary" onClick={onClose}>{c.ok}</button>
      </div>
    </section>
  );
}
