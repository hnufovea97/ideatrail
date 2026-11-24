import { useState } from "preact/hooks";
import { COPY } from "../../lib/copy";
import type { VersionStore } from "../../lib/engine-list";
import { routineShown, setRoutineShown } from "../../lib/home/prefs";

/** 루틴 점검 보기: this device only (the same switch the home has). */
export function RoutineSection({ store, userId }: { store: VersionStore; userId: string }) {
  const m = COPY.manage.routine;
  const [on, setOn] = useState(() => routineShown(store, userId));
  return (
    <section aria-labelledby="routine-title">
      <h2 id="routine-title">{m.title}</h2>
      <label class="choice"><input type="checkbox" checked={on} onChange={(e) => { setRoutineShown(store, userId, e.currentTarget.checked); setOn(e.currentTarget.checked); }} /> {m.label}</label>
      <p class="small">{m.note}</p>
    </section>
  );
}
