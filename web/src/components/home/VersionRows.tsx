import { COPY } from "../../lib/copy";
import type { VersionRow } from "../../lib/home/life";
import { Locked } from "../ui/ServerToggle";

/** Version rows (ADR-0018): date · name · the one file of that version · fingerprint ends · blockchain state. */
export function VersionRows({ rows, server }: { rows: readonly VersionRow[]; server: boolean }) {
  const l = COPY.life;
  return (
    <ul class="vers">
      {rows.map((v) => (
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
        </li>
      ))}
    </ul>
  );
}
