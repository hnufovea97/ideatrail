import { useMemo, useState } from "preact/hooks";
import { COPY } from "../../lib/copy";
import { shortDate } from "../../lib/home/format";
import { lifeOf, type StageRow } from "../../lib/home/life";
import { routineCard, stalledDays } from "../../lib/home/routine";
import type { IdeaView } from "../../lib/model/read-model";
import { stageNames } from "../../lib/model/stage-names";
import type { StageNo } from "../../lib/model/stage";
import { Locked } from "../ui/ServerToggle";
import { LockIcon } from "./LockIcon";
import { RoutineCard } from "./RoutineCard";
import { StageRename } from "./StageRename";
import { VersionRows } from "./VersionRows";

interface Props {
  idea: IdeaView; server: boolean; now: Date; routineOn: boolean; feedbackFolded: boolean;
  onBack(): void; onRoutine(on: boolean): void; onFoldFeedback(folded: boolean): void; onRename(rootId: string, names: readonly string[]): Promise<void>;
}

/** 결정 n · 미룸 n · 변곡점 chips with the "AI가 센 수" hint (ADR-0019: the AI counted, it may be off). */
function Counts({ decided, deferred, turn, server }: { decided: number | null; deferred: number | null; turn: string | null; server: boolean }) {
  const l = COPY.life;
  if (decided === null && deferred === null && turn === null) return null;
  return (
    <span class="counts">
      {decided !== null ? <span class="chip"><Locked server={server}>{l.decided} {decided}</Locked></span> : null}
      {deferred !== null ? <span class="chip"><Locked server={server}>{l.deferred} {deferred}</Locked></span> : null}
      {turn !== null ? <span class="chip turn"><Locked server={server}>{l.turn} · {turn}</Locked></span> : null}
      {decided !== null || deferred !== null ? <span class="hint">{l.counted}</span> : null}
    </span>
  );
}

function StagePanel({ row, server }: { row: StageRow; server: boolean }) {
  const l = COPY.life;
  if (!row.reached) return <div class="panel"><p class="small">{l.notYet}</p></div>;
  return (
    <div class="panel">
      <p class="panel-head">
        <strong><Locked server={server}>{row.name}</Locked></strong>
        {row.range ? <span class="small"><Locked server={server}>{row.range}</Locked></span> : null}
        {row.estimated ? <span class="hint"><Locked server={server}>{l.estimated}</Locked></span> : null}
        <Counts decided={row.decided} deferred={row.deferred} turn={row.turn} server={server} />
      </p>
      {row.versions.length > 0 ? <VersionRows rows={row.versions} server={server} /> : <p class="small">{l.skipped}</p>}
    </div>
  );
}

/** Idea life (UX ②): header · dates · five stage cells (tap to open) · stage panel · routine check card. */
export function IdeaLife({ idea, server, now, routineOn, feedbackFolded, onBack, onRoutine, onFoldFeedback, onRename }: Props) {
  const l = COPY.life;
  const life = useMemo(() => lifeOf(idea), [idea]);
  const [open, setOpen] = useState<StageNo>(idea.locked.stage);
  const [renaming, setRenaming] = useState(false);
  const stall = routineOn ? stalledDays(idea, now) : null; // 설계 §3.1.4: off hides the stopped days too
  const row = life.stages[open - 1];
  return (
    <article class="life" aria-labelledby="life-title">
      <button type="button" class="link back" onClick={onBack}>{l.back}</button>
      <h2 id="life-title">
        <Locked server={server}>{idea.locked.title}</Locked>
        {idea.server.visibility === "private" ? <span class="lock" role="img" aria-label={COPY.home.mine}><LockIcon /></span> : null}
        <span class="small">{l.visibility[idea.server.visibility]} · {l.versions(idea.server.versionCount)}</span>
      </h2>
      {idea.locked.tags.length > 0 ? <p class="tags"><Locked server={server}>{idea.locked.tags.map((t) => `#${t}`).join(" ")}</Locked></p> : null}
      <p class="life-counts"><Counts decided={life.decided} deferred={life.deferred} turn={null} server={server} /></p>
      <details class="name-hint">
        <summary><Locked server={server}>{l.nameHint}</Locked> · <span class="link">{l.how}</span></summary>
        <p class="small">{l.howBody}</p>
      </details>
      <p class="dates">
        <span class="date"><b>{l.first}</b>{shortDate(idea.server.firstAt)}</span>
        <span class="date"><b>{l.last}</b>{shortDate(idea.server.lastAt)}</span>
      </p>
      <div class="stages" role="group" aria-label={l.stagesLabel(idea.locked.stage)}>
        {life.stages.map((s) => (
          <button key={s.no} type="button" class={s.reached ? "stg done" : "stg"} aria-pressed={s.no === open} onClick={() => setOpen(s.no)}>
            <Locked server={server}><span class="seg" /></Locked>
            <span class="stg-name"><Locked server={server}>{s.name}</Locked>
              {s.current && idea.locked.paused ? <span class="hint"> {l.paused}</span> : null}
              {s.current && stall !== null ? <span class="hint"> {l.stalled(stall)}</span> : null}
            </span>
            <span class="stg-date"><Locked server={server}>{s.date ?? "—"}</Locked></span>
          </button>
        ))}
      </div>
      {server ? null : renaming
        ? <StageRename names={stageNames(idea)} onSave={(names) => onRename(idea.rootId, names)} onClose={() => setRenaming(false)} />
        : <p class="rename-row"><button type="button" class="link" onClick={() => setRenaming(true)}>{l.rename.open}</button></p>}
      <StagePanel row={row} server={server} />
      {routineOn
        ? <RoutineCard card={routineCard(idea, feedbackFolded)} server={server} onHide={() => onRoutine(false)} onFoldFeedback={onFoldFeedback} />
        : <p class="routine-off small">{l.routine.hiddenNote} <button type="button" class="link" onClick={() => onRoutine(true)}>{l.routine.show}</button></p>}
    </article>
  );
}
