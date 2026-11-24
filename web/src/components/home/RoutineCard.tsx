import { COPY } from "../../lib/copy";
import type { RoutineCard as Card } from "../../lib/home/routine";
import { monthDay } from "../../lib/home/format";
import { Locked } from "../ui/ServerToggle";

interface Props { card: Card; server: boolean; onHide(): void; onFoldFeedback(folded: boolean): void }

/** Routine check (설계 §3.1.4): filled ✓ / empty ○ "아직 없음", the next slot stands out, no score. */
export function RoutineCard({ card, server, onHide, onFoldFeedback }: Props) {
  const r = COPY.life.routine;
  return (
    <section class="routine" aria-labelledby="routine-title">
      <h3 id="routine-title"><Locked server={server}>{r.title(card.total, card.filled)}</Locked></h3>
      {card.groups.map((g) => (
        <div key={g.key} class="routine-group">
          <p class="routine-name">{r.groups[g.key]}</p>
          <ul>
            {g.items.map((i) => (
              <li key={i.slot} class={i.filled ? "slot yes" : i.next ? "slot next" : "slot no"} aria-current={i.next ? "step" : undefined}>
                <span class="slot-mark" role="img" aria-label={i.filled ? r.filled : r.empty}>{i.filled ? "✓" : "○"}</span>
                <span class="slot-name">
                  <Locked server={server}>{r.slots[i.slot]}{i.filled && i.estimated ? <span class="est">{COPY.life.estimated}</span> : null}</Locked>
                  {i.next ? <span class="sr-only">{r.next}</span> : null}
                </span>
                <span class="slot-when"><Locked server={server}>{i.filled && i.at ? monthDay(i.at) : r.empty}</Locked></span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div class="routine-foot">
        <span class="small">{r.note}</span>
        <button type="button" class="link" onClick={() => onFoldFeedback(!card.feedbackFolded)}>{card.feedbackFolded ? r.feedbackOn : r.feedbackOff}</button>
        <button type="button" class="link" onClick={onHide}>{r.hide}</button>
      </div>
    </section>
  );
}
