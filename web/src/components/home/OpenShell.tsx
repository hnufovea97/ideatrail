import { useEffect, useRef, useState } from "preact/hooks";
import type { Api } from "../../lib/api";
import { COPY } from "../../lib/copy";
import { refresh, refreshFailure, type Loaded, type LoadDeps, type RefreshFailure } from "../../lib/dashboard/load";
import { browserStore } from "../../lib/engine-list";
import { RowCache } from "../../lib/sync/cache";
import { chainLine, type ChainStatus } from "../../lib/sync/chain";
import { emptySync, type SyncState } from "../../lib/sync/store";
import { SYNC_MS } from "../../lib/timing";
import type { DashboardVault } from "../../lib/unlock";

/** `signal` is aborted by the lock before it wipes the keys: a refresh in flight then writes nothing. */
interface Props { api: Api; vault: DashboardVault; signal: AbortSignal; onLock(): void }
const CHECKING: ChainStatus = { state: "checking" };

/** The unlocked page. M5a shows the chain line and the idea count; the home UI (5.4) renders `loaded.ideas` in M5b. */
export function OpenShell({ api, vault, signal, onLock }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<RefreshFailure | null>(null);
  const sync = useRef<SyncState>(emptySync());
  const mirrorDirty = useRef(false); // a saved merge not yet in index/: every later refresh retries until "done"

  useEffect(() => {
    let live = true;
    let running = false;
    const cache = new RowCache(); // verified rows and opened metas of this open vault only
    const deps: LoadDeps = { api, github: (input, init) => fetch(input, init), marks: browserStore(), now: () => new Date(), alive: () => live && !signal.aborted, cache };
    const run = () => {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      refresh(deps, vault, sync.current, mirrorDirty.current)
        .then((l) => {
          if (!live) return;
          sync.current = l.sync;
          mirrorDirty.current = l.mirrorDirty;
          setLoaded(l);
          setFailure(null);
        }, (e: unknown) => { if (live) setFailure(refreshFailure(e)); })
        .finally(() => { running = false; });
    };
    run();
    const t = setInterval(run, SYNC_MS);
    document.addEventListener("visibilitychange", run);
    return () => {
      live = false; // a refresh still in flight is dropped; its keys are the vault's, wiped by the lock
      cache.clear();
      clearInterval(t);
      document.removeEventListener("visibilitychange", run);
    };
  }, [api, vault, signal]);

  const chain = loaded?.chain ?? CHECKING;
  return (
    <main class="screen dash">
      <h1 tabIndex={-1}>{COPY.dash.lockTitle}</h1>
      {chain.state === "warn"
        ? <p class="banner warn" role="alert">{chainLine(chain)}</p>
        : <p class="small" role="status">{failure ? COPY.dash.errors[failure] : chainLine(chain)}</p>}
      {loaded ? <p>{COPY.dash.ideas(loaded.ideas.length)}</p> : null}
      {loaded?.mirror === "failed" ? <p class="small">{COPY.dash.mirrorFailed}</p> : null}
      <button type="button" onClick={onLock}>{COPY.dash.lockNow}</button>
    </main>
  );
}
