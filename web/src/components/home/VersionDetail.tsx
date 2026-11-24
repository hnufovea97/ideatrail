import { useEffect, useState } from "preact/hooks";
import { COPY } from "../../lib/copy";
import type { VersionView } from "../../lib/model/read-model";
import type { Source } from "../../lib/versions/source";
import { OriginalView } from "./OriginalView";
import { ProofJourney } from "./ProofJourney";

export interface Connect { phase: "idle" | "waiting"; error: string | null; start(): void }
/** What the version rows need to look into GitHub; `tick` changes when the GitHub link was just made. */
export interface RowTools { load(recordId: string): Promise<Source>; version(recordId: string): VersionView | undefined; connect: Connect; tick: number }
/** The same for a whole idea: the screen resolves a row's id to its version and the one before it. */
export interface SourceTools { load(v: VersionView, previous: VersionView | null): Promise<Source>; connect: Connect; tick: number }

/** The opened part of one version row: where its original stands (5.13 notices, found, failed) and the proof journey (5.8). */
function sourceBody(source: Source | null, tools: RowTools, onRetry: () => void) {
  const s = COPY.life.source;
  if (!source) return <p class="small" role="status">{s.checking}</p>;
  switch (source.kind) {
    case "unlinked":
      return (
        <>
          <p class="small">{s.unlinked}</p>
          {tools.connect.phase === "waiting"
            ? <p class="small" role="status">{COPY.github.waiting}</p>
            : <button type="button" onClick={tools.connect.start}>{s.connect}</button>}
          {tools.connect.error ? <p class="error" role="alert">{tools.connect.error}</p> : null}
        </>
      );
    case "not_yet": return <p class="small">{s.notYet}</p>;
    case "failed":
      return (
        <>
          <p class="error" role="alert">{s.failed}</p>
          <button type="button" onClick={onRetry}>{COPY.actions.retry}</button>
        </>
      );
    case "ready": return <OriginalView source={source} />;
  }
}

export function VersionDetail({ recordId, tools }: { recordId: string; tools: RowTools }) {
  const [source, setSource] = useState<Source | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setSource(null);
    tools.load(recordId).then((r) => { if (live) setSource(r); }, () => { if (live) setSource({ kind: "failed" }); });
    return () => { live = false; };
  }, [recordId, tools.tick, attempt]);

  const version = tools.version(recordId);
  return (
    <div class="ver-detail">
      {sourceBody(source, tools, () => setAttempt((n) => n + 1))}
      {version ? <ProofJourney version={version} source={source} /> : null}
    </div>
  );
}
