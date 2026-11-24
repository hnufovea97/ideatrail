import { useState } from "preact/hooks";
import { COPY } from "../../lib/copy";
import type { VersionRow } from "../../lib/home/life";
import { Locked } from "../ui/ServerToggle";
import { VersionDetail, type RowTools } from "./VersionDetail";

/** Version rows (ADR-0018): date · name · the one file of that version · fingerprint ends · blockchain state.
 * In the device view a row opens to show where its original stands (5.13); never while the server's view is on. */
export function VersionRows({ rows, server, tools }: { rows: readonly VersionRow[]; server: boolean; tools: RowTools }) {
  const l = COPY.life;
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul class="vers">
      {rows.map((v) => {
        const shown = !server && open === v.recordId;
        return (
          <li key={v.recordId} class="ver">
            <span class="ver-when">{v.when}</span>
            <span class="ver-what">
              <Locked server={server}>{v.name}</Locked>
              {v.file ? <span class="ver-file"><Locked server={server}>{l.file}: {v.file}</Locked></span> : null}
            </span>
            <span class="ver-proof">
              <span class="fp" title={l.fingerprint}>{v.fingerprint}</span>
              <span class={`pill ${v.chain}`}>{COPY.home.chain[v.chain]}</span>
            </span>
            {server ? null : <button type="button" class="link ver-toggle" aria-expanded={shown} onClick={() => setOpen(shown ? null : v.recordId)}>{shown ? l.source.close : l.source.open}</button>}
            {shown ? <div class="ver-open"><VersionDetail recordId={v.recordId} tools={tools} /></div> : null}
          </li>
        );
      })}
    </ul>
  );
}
