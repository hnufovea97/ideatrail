import type { Api } from "../../lib/api";
import { COPY } from "../../lib/copy";
import { openNotes } from "../../lib/home/reminder";
import type { DashboardVault } from "../../lib/unlock";
import { NoteEditor } from "./NoteEditor";

interface Props { api: Api; vault: DashboardVault; blob: string | null }

/** 기억 메모 in 설정: the same editor as the check card, opened with the saved note. */
export function NoteSection({ api, vault, blob }: Props) {
  return (
    <section aria-labelledby="note-title">
      <h2 id="note-title">{COPY.note.title}</h2>
      <NoteEditor api={api} vault={vault} initial={openNotes(vault.mk, vault.userId, blob)} idPrefix="settings" onSaved={() => undefined} />
    </section>
  );
}
