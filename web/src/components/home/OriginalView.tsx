import { useMemo } from "preact/hooks";
import { COPY } from "../../lib/copy";
import type { Source } from "../../lib/versions/source";
import { textOf } from "../../lib/versions/original";

/** Lines of text shown before the rest is folded: a phone page, not a file viewer. */
const SHOWN_LINES = 300;

const MARK = { same: "  ", add: "+ ", del: "− " } as const;

function Lines({ lines }: { lines: readonly { op: "same" | "add" | "del"; text: string }[] }) {
  const s = COPY.life.source;
  const shown = lines.slice(0, SHOWN_LINES);
  return (
    <pre class="orig" tabIndex={0}>
      {shown.map((l, i) => <span key={i} class={`dl ${l.op}`} aria-label={l.op === "same" ? undefined : s[l.op]}>{MARK[l.op]}{l.text}{"\n"}</span>)}
      {lines.length > SHOWN_LINES ? <span class="small">{s.cut(lines.length - SHOWN_LINES)}</span> : null}
    </pre>
  );
}

/** The found original of one version: the fingerprint check first, then the text, the changed lines, or the file names. */
export function OriginalView({ source }: { source: Extract<Source, { kind: "ready" }> }) {
  const s = COPY.life.source;
  const o = source.original;
  // decode and split once per opened original, not on every 60-second refresh redraw
  const textLines = useMemo(() => textOf(o)?.split(/\r?\n/).map((t) => ({ op: "same" as const, text: t })) ?? null, [o]);
  if (o.kind === "no_original") return <p class="small">{s.noOriginal}</p>;
  if (o.kind === "mismatch") return <p class="error" role="alert">{s.mismatch}</p>;
  if (o.kind === "unreadable") return <p class="error" role="alert">{s.unreadable}</p>;
  if (!o.same) return <p class="error" role="alert">{s.changed}</p>;
  return (
    <div class="ver-detail">
      <p class="same" role="status">✓ {s.same}</p>
      {source.diff ? <p class="small">{s.diffTitle}</p> : null}
      {source.diff?.lines ? <Lines lines={source.diff.lines} /> : null}
      {source.diff && !source.diff.lines ? <p class="small">{s.noDiff}</p> : null}
      {!source.diff && textLines !== null ? <Lines lines={textLines} /> : null}
      {textLines === null ? <p class="small">{s.files(o.files.length)}: {o.files.map((f) => f.path).join(", ")}</p> : null}
    </div>
  );
}
