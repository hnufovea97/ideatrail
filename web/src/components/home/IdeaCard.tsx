import { COPY } from "../../lib/copy";
import { shortDate } from "../../lib/home/format";
import { ideaChain } from "../../lib/home/list";
import type { IdeaView } from "../../lib/model/read-model";
import { stageNameOf } from "../../lib/model/stage-names";
import { STAGE_NUMBERS } from "../../lib/model/stage";
import { Locked } from "../ui/ServerToggle";
import { LockIcon } from "./LockIcon";

interface Props { idea: IdeaView; server: boolean; selected: boolean; onPick(rootId: string): void }

/** Home card (UX ①): name + lock · n/5 stage + 5-cell bar · first/last record · #tags · blockchain badge. */
export function IdeaCard({ idea, server, selected, onPick }: Props) {
  const h = COPY.home;
  const { locked, server: srv } = idea;
  const chain = ideaChain(idea);
  return (
    <button type="button" class="card" aria-current={selected ? "true" : undefined} onClick={() => onPick(idea.rootId)}>
      <span class="card-name">
        <Locked server={server}>{locked.title}</Locked>
        {srv.visibility === "private" ? <span class="lock" role="img" aria-label={h.mine}><LockIcon /></span> : null}
      </span>
      <span class="card-stage small"><Locked server={server}>{h.stageOf(locked.stage, stageNameOf(idea, locked.stage))}</Locked></span>
      <Locked server={server}>
        <span class="bar" aria-hidden="true">{STAGE_NUMBERS.map((no) => <i key={no} class={no <= locked.stage ? "on" : ""} />)}</span>
      </Locked>
      <span class="card-dates small">{h.dates(shortDate(srv.firstAt), shortDate(srv.lastAt))}</span>
      <span class="card-foot">
        {locked.tags.length > 0 ? <span class="tags"><Locked server={server}>{locked.tags.map((t) => `#${t}`).join(" ")}</Locked></span> : <span />}
        <span class={`pill ${chain}`}>{h.chain[chain]}</span>
      </span>
    </button>
  );
}
