import { COPY } from "../../lib/copy";
import type { VersionView } from "../../lib/model/read-model";
import { exportBundle, exportName } from "../../lib/proof/bundle";
import { saveJson } from "../../lib/proof/download";
import { journeyOf } from "../../lib/proof/journey";
import type { Source } from "../../lib/versions/source";

/** Five steps of one version, each with the state this browser found; plus the proof file once the original is open and intact. */
export function ProofJourney({ version, source }: { version: VersionView; source: Source | null }) {
  const j = COPY.life.journey;
  const original = source?.kind === "ready" ? source.original : null;
  const exportable = original?.kind === "opened" && original.same ? original : null;
  return (
    <div class="journey-box">
      <p class="small">{j.title}</p>
      <ol class="journey">
        {journeyOf(version, source).map((s) => (
          <li key={s.key} class={s.state}>
            <span>{j.steps[s.key]}</span>
            <span class="st">{s.note ? j.notes[s.note] : j.state[s.state]}</span>
          </li>
        ))}
      </ol>
      {exportable ? (
        <>
          <button type="button" onClick={() => saveJson(exportName(version.recordId), exportBundle(version, exportable.nonce, exportable.manifest))}>{j.export}</button>
          <p class="small">{j.exportNote}</p>
        </>
      ) : null}
    </div>
  );
}
