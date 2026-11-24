import { useEffect, useState } from "preact/hooks";
import { COPY } from "../../lib/copy";
import type { Source } from "../../lib/versions/source";

export interface Connect { phase: "idle" | "waiting"; error: string | null; start(): void }
/** What the version rows need to look into GitHub; `tick` changes when the GitHub link was just made. */
export interface SourceTools { load(recordId: string): Promise<Source>; connect: Connect; tick: number }

/** The opened part of one version row: where its original stands (5.13 notices, found, failed). */
export function VersionDetail({ recordId, tools }: { recordId: string; tools: SourceTools }) {
  const s = COPY.life.source;
  const [source, setSource] = useState<Source | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setSource(null);
    tools.load(recordId).then((r) => { if (live) setSource(r); }, () => { if (live) setSource({ kind: "failed" }); });
    return () => { live = false; };
  }, [recordId, tools.tick, attempt]);

  if (!source) return <p class="small" role="status">{s.checking}</p>;
  switch (source.kind) {
    case "unlinked":
      return (
        <div class="ver-detail">
          <p class="small">{s.unlinked}</p>
          {tools.connect.phase === "waiting"
            ? <p class="small" role="status">{COPY.github.waiting}</p>
            : <button type="button" onClick={tools.connect.start}>{s.connect}</button>}
          {tools.connect.error ? <p class="error" role="alert">{tools.connect.error}</p> : null}
        </div>
      );
    case "not_yet": return <p class="small">{s.notYet}</p>;
    case "failed":
      return (
        <div class="ver-detail">
          <p class="error" role="alert">{s.failed}</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>{COPY.actions.retry}</button>
        </div>
      );
    case "ready": return <p class="small">{s.found}</p>;
  }
}
