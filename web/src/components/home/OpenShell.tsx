import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { fromB64u } from "@ideatrail/crypto/bytes";
import type { Api } from "../../lib/api";
import { openApprovals, type OpenApproval } from "../../lib/approvals";
import { COPY } from "../../lib/copy";
import { refresh, refreshFailure, type Loaded, type LoadDeps, type RefreshFailure } from "../../lib/dashboard/load";
import { browserStore } from "../../lib/engine-list";
import { saveStageNames } from "../../lib/merge/stages-save";
import { browserExplorers } from "../../lib/proof/explorers";
import { withConfirmations } from "../../lib/proof/overlay";
import { ConfirmSession } from "../../lib/proof/session";
import { RowCache } from "../../lib/sync/cache";
import { chainLine, type ChainStatus } from "../../lib/sync/chain";
import { emptySync, type SyncState } from "../../lib/sync/store";
import { SYNC_MS } from "../../lib/timing";
import type { DashboardVault, VaultPatch } from "../../lib/unlock";
import { storageLinkValid } from "../../lib/github-link";
import { shortcutNeeded } from "../../lib/home/reminder";
import { loadSource, refOf } from "../../lib/versions/source";
import { useGithubLink } from "../start/useGithubLink";
import { Approvals } from "./Approvals";
import { CheckCard } from "./CheckCard";
import { useCheckCard } from "./useCheckCard";
import { Home } from "./Home";
import { Settings } from "./Settings";
import type { SourceTools } from "./VersionDetail";

/** `signal` is aborted by the lock before it wipes the keys: a refresh in flight then writes nothing. */
interface Props { api: Api; vault: DashboardVault; signal: AbortSignal; onLock(): void; onVault(patch: VaultPatch): void; onGone(notice?: string): void }
type View = "home" | "approvals" | "settings";
const CHECKING: ChainStatus = { state: "checking" };

/** A touch phone with the page still in the browser (not added to the home screen). */
function onPhoneBrowser(): boolean {
  const media = (q: string) => typeof matchMedia === "function" && matchMedia(q).matches;
  return shortcutNeeded({
    touch: media("(pointer: coarse)"), narrow: media("(max-width: 600px)"),
    standalone: media("(display-mode: standalone)") || (navigator as { standalone?: boolean }).standalone === true,
  });
}

/** The unlocked page: the chain line and the home (5.4·5.5) drawn from `loaded.ideas`. */
export function OpenShell({ api, vault, signal, onLock, onVault, onGone }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<RefreshFailure | null>(null);
  const sync = useRef<SyncState>(emptySync());
  const mirrorDirty = useRef(false); // a saved merge not yet in index/: every later refresh retries until "done"
  const refreshNow = useRef<() => void>(() => undefined);
  const justLinked = useRef(false); // the GitHub link was made: the next finished refresh brings it in, then open versions look again
  const [linkTick, setLinkTick] = useState(0);
  const confirmations = useRef<ConfirmSession | null>(null); // this session's two-explorer results (5.7), memory only
  const [confirmTick, setConfirmTick] = useState(0);
  const [view, setView] = useState<View>("home");
  const [pending, setPending] = useState<readonly OpenApproval[]>([]);
  const store = useMemo(() => browserStore(), []);
  const vaultRef = useRef(vault); // the effects below depend on who is signed in, not on each patched copy of the vault
  vaultRef.current = vault;
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(view);
  useEffect(() => {
    if (shown.current !== view && view === "home") heading.current?.focus(); // back from a view: the page title, as a new screen would
    shown.current = view;
  }, [view]);

  /** Changes the open vault (engine list, auto-lock minutes) without turning the page over. A locked vault takes nothing. */
  const patchVault = useCallback((patch: VaultPatch) => {
    if (signal.aborted) return;
    vaultRef.current = { ...vaultRef.current, ...patch }; // the next refresh in this tick already sees it
    onVault(patch);
  }, [signal, onVault]);

  /** The waiting requests: only those a live engine signed and this account can open (5.9a). A failed load keeps the last list. */
  const loadApprovals = useCallback(() => {
    const v = vaultRef.current;
    void api.approvals()
      .then((r) => (signal.aborted ? null : openApprovals(r.approvals, v.engineList, v, store)))
      .then((items) => { if (items && !signal.aborted) setPending(items); }, () => undefined);
  }, [api, signal, store]);

  useEffect(() => {
    let live = true;
    let running = false;
    const cache = new RowCache(); // verified rows and opened metas of this open vault only
    const session = new ConfirmSession(browserExplorers((input, init) => fetch(input, init)));
    confirmations.current = session;
    const deps: LoadDeps = { api, github: (input, init) => fetch(input, init), marks: browserStore(), now: () => new Date(), alive: () => live && !signal.aborted, cache, signal };
    let again = false; // a save arrived while a refresh was running: go once more when it ends
    const run = () => {
      if (document.visibilityState !== "visible") return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      refresh(deps, vaultRef.current, sync.current, mirrorDirty.current)
        .then((l) => {
          if (!live) return;
          sync.current = l.sync;
          mirrorDirty.current = l.mirrorDirty;
          setLoaded(l);
          void session.check(l.ideas, signal).then((changed) => { if (changed && live) setConfirmTick((n) => n + 1); }, () => undefined);
          setFailure(null);
          loadApprovals();
          if (justLinked.current) {
            justLinked.current = false;
            setLinkTick((n) => n + 1);
          }
        }, (e: unknown) => { if (live) setFailure(refreshFailure(e)); })
        .finally(() => {
          running = false;
          if (again && live) {
            again = false;
            run();
          }
        });
    };
    refreshNow.current = run;
    run();
    const t = setInterval(run, SYNC_MS);
    document.addEventListener("visibilitychange", run);
    return () => {
      live = false; // a refresh still in flight is dropped; its keys are the vault's, wiped by the lock
      cache.clear();
      session.clear();
      confirmations.current = null;
      clearInterval(t);
      document.removeEventListener("visibilitychange", run);
    };
  }, [api, vault.userId, signal, loadApprovals]);

  const chain = loaded?.chain ?? CHECKING;
  // 확산됨 only where this browser checked the block at both explorers; the server's "confirmed" alone reads 확인 중
  const ideas = useMemo(() => (loaded ? withConfirmations(loaded.ideas, confirmations.current?.results ?? new Map()) : null), [loaded, confirmTick]);
  /** The user's stage names (ADR-0020): sealed into the root meta here, then shown by the next refresh and written to index/. */
  const rename = async (rootId: string, names: readonly string[]) => {
    const saved = await saveStageNames(api, vault, store, sync.current, rootId, names);
    sync.current = saved.sync;
    mirrorDirty.current = true;
    refreshNow.current();
  };
  const engine = vault.engineList.engines.find((e) => e.revoked_at === undefined && e.revoked_after_seq === undefined && e.revoked_digest === undefined) ?? null;
  const link = useGithubLink(api, { vault, engine, kemPub: engine ? fromB64u(engine.kem_pubkey) : new Uint8Array() }, () => {
    justLinked.current = true;
    refreshNow.current();
  });
  const check = useCheckCard(api, vault, signal);
  const githubLinked = engine !== null && [...(loaded?.sync.links.values() ?? [])].some((l) => storageLinkValid(l, engine, vault.userId));
  const tools: SourceTools = {
    load: (v, previous) => loadSource({ vault, links: sync.current.links.values(), github: (input, init) => fetch(input, init), signal }, refOf(v), previous ? refOf(previous) : null),
    connect: link, tick: linkTick,
  };
  return (
    <main class="screen dash">
      <header class="dash-head">
        <h1 ref={heading} tabIndex={-1}>{COPY.dash.lockTitle}</h1>
        <p class="small chain-line" role="status">{failure ? COPY.dash.errors[failure] : chain.state === "warn" ? "" : chainLine(chain)}</p>
        <button type="button" class="lock-now" disabled={!loaded} onClick={() => setView("settings")}>{COPY.manage.settingsOpen}</button>
        <button type="button" class="lock-now" onClick={onLock}>{COPY.dash.lockNow}</button>
      </header>
      {chain.state === "warn" ? <p class="banner warn" role="alert">{chainLine(chain)}</p> : null}
      {pending.length > 0 && view !== "approvals" ? (
        <p class="banner" role="status">{COPY.manage.banner(pending.length)} <button type="button" class="link" onClick={() => { setView("approvals"); loadApprovals(); }}>{COPY.manage.bannerAction}</button></p>
      ) : null}
      {loaded?.mirror === "failed" ? <p class="small">{COPY.dash.mirrorFailed}</p> : null}
      {view === "approvals" ? <Approvals api={api} vault={vault} signal={signal} items={pending} onDecided={loadApprovals} onBack={() => setView("home")} /> : null}
      {view === "settings" && !loaded ? <p class="small">{COPY.home.loading}</p> : null}
      {view === "settings" && loaded ? (
        <Settings api={api} vault={vault} signal={signal} sync={loaded.sync} store={store} onVault={patchVault} onRefresh={() => refreshNow.current()} onDeleted={onGone} onBack={() => setView("home")} />
      ) : null}
      {view === "home" && check.data ? (
        <CheckCard api={api} vault={vault} signal={signal} data={check.data} githubLinked={githubLinked} github={link} showShortcut={onPhoneBrowser()}
          onMakeKey={() => setView("settings")} onNotes={check.setNotes} onClose={check.close} />
      ) : null}
      {view === "home" && ideas ? <Home ideas={ideas} tools={tools} userId={vault.userId} store={store} now={new Date()} onRename={rename} /> : null}
      {view === "home" && !ideas ? <p class="small">{COPY.home.loading}</p> : null}
    </main>
  );
}
