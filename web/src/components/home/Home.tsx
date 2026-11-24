import { useMemo, useState } from "preact/hooks";
import { COPY } from "../../lib/copy";
import type { VersionStore } from "../../lib/engine-list";
import { DEFAULT_SORT, SORT_KEYS, TABS, isSortKey, listIdeas, type SortKey, type Tab } from "../../lib/home/list";
import { feedbackHidden, loadOpened, loadSort, noteOpened, routineShown, saveSort, setFeedbackHidden, setRoutineShown } from "../../lib/home/prefs";
import type { IdeaView } from "../../lib/model/read-model";
import { ServerToggle } from "../ui/ServerToggle";
import { IdeaCard } from "./IdeaCard";
import { IdeaLife } from "./IdeaLife";

interface Props { ideas: readonly IdeaView[]; userId: string; store: VersionStore; now: Date }

function emptyText(ideas: readonly IdeaView[], tab: Tab, query: string): string {
  const e = COPY.home.empty;
  if (ideas.length === 0) return e.none;
  if (query.trim().length > 0) return e.search;
  return tab === "shared" ? e.shared : e.mine;
}

/** The unlocked home (ADR-0018): server-view switch · tabs · search · sort · cards, and the chosen idea's life. */
export function Home({ ideas, userId, store, now }: Props) {
  const h = COPY.home;
  const [server, setServer] = useState(true); // ADR-0018: on by default, every time the home opens
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>(() => loadSort(store, userId));
  const [opened, setOpened] = useState(() => loadOpened(store, userId));
  const [picked, setPicked] = useState<string | null>(null);
  const [routineOn, setRoutineOn] = useState(() => routineShown(store, userId));
  const [folded, setFolded] = useState(() => feedbackHidden(store, userId));

  const shown = useMemo(() => listIdeas(ideas, { tab, query, sort, opened }), [ideas, tab, query, sort, opened]);
  const chosen = ideas.find((i) => i.rootId === picked) ?? null;

  const pick = (rootId: string) => {
    setPicked(rootId);
    setOpened(noteOpened(store, userId, rootId, Date.now()));
  };
  const changeSort = (v: string) => {
    const next = isSortKey(v) ? v : DEFAULT_SORT;
    saveSort(store, userId, next);
    setSort(next);
  };
  const changeRoutine = (on: boolean) => {
    setRoutineShown(store, userId, on);
    setRoutineOn(on);
  };

  return (
    <div class={server ? "home srv" : "home"}>
      <div class="home-switch">
        <ServerToggle checked={server} label={h.toggle} onChange={setServer} />
        <p class={server ? "server-note on" : "server-note"} aria-live="polite">{server ? h.serverNote : h.deviceNote}</p>
      </div>
      <div class={chosen ? "home-main picked" : "home-main"}>
        <section class="home-list" aria-label={h.listLabel}>
          <div class="tabs" role="group" aria-label={h.tabsLabel}>
            {TABS.map((t) => <button key={t} type="button" aria-pressed={t === tab} onClick={() => setTab(t)}>{h.tabs[t]}</button>)}
          </div>
          <label class="search">
            <span class="sr-only">{h.searchLabel}</span>
            <input type="search" value={query} placeholder={h.searchHint} onInput={(e) => setQuery(e.currentTarget.value)} />
          </label>
          <div class="list-bar">
            <span class="small" role="status">{h.count(shown.length)}</span>
            <label class="sort">{h.sortLabel}
              <select value={sort} onChange={(e) => changeSort(e.currentTarget.value)}>
                {SORT_KEYS.map((k) => <option key={k} value={k}>{h.sorts[k]}</option>)}
              </select>
            </label>
          </div>
          {shown.length > 0
            ? <div class="cards">{shown.map((i) => <IdeaCard key={i.rootId} idea={i} server={server} selected={i.rootId === picked} onPick={pick} />)}</div>
            : <p class="empty">{emptyText(ideas, tab, query)}</p>}
        </section>
        <section class="home-detail" aria-live="polite">
          {chosen
            ? <IdeaLife key={chosen.rootId} idea={chosen} server={server} now={now} routineOn={routineOn} feedbackFolded={folded.has(chosen.rootId)}
                onBack={() => setPicked(null)} onRoutine={changeRoutine} onFoldFeedback={(f) => setFolded(setFeedbackHidden(store, userId, chosen.rootId, f))} />
            : <p class="empty">{h.pick}</p>}
        </section>
      </div>
    </div>
  );
}
