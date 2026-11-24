import { useState } from "preact/hooks";
import type { Api } from "../../lib/api";
import { COPY, manageError } from "../../lib/copy";
import { browserStore, rememberVersion } from "../../lib/engine-list";
import { githubTokenFor, isLive, liveEngines, revokeList, sealRevoked } from "../../lib/engines";
import { shortDate } from "../../lib/home/format";
import { verifyRows } from "../../lib/sync/verify";
import { memoryStore } from "../../lib/engine-list";
import type { SyncState } from "../../lib/sync/store";
import type { DashboardVault } from "../../lib/unlock";
import { useStepup } from "../ui/useStepup";

interface Props { api: Api; vault: DashboardVault; sync: SyncState; onVault(v: DashboardVault): void; onChanged(): void }

function lastRecord(sync: SyncState, engineId: string): { at: string; n: number } | null {
  const mine = [...sync.records.values()].filter((r) => r.engine_id === engineId);
  if (mine.length === 0) return null;
  return { at: mine.reduce((m, r) => (r.recorded_at > m ? r.recorded_at : m), ""), n: mine.length };
}

function Row({ api, vault, sync, engineId, onVault, onChanged }: Props & { engineId: string }) {
  const m = COPY.manage.engines;
  const entry = vault.engineList.engines.find((e) => e.engine_id === engineId)!;
  const live = isLive(entry);
  const server = sync.engines.get(engineId);
  const paused = live && server?.paused === 1;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resume = useStepup(api, "POST", paused ? `/v1/engines/${engineId}/resume` : null);
  const revoke = useStepup(api, "POST", confirming ? `/v1/engines/${engineId}/revoke` : null);
  const last = lastRecord(sync, engineId);
  const lastOne = liveEngines(vault.engineList).length === 1;

  const run = (job: Promise<unknown>) => {
    setBusy(true);
    setError(null);
    void job.then(() => { setBusy(false); onChanged(); }, (e: unknown) => { setBusy(false); setError(manageError(e)); });
  };

  function pause() {
    if (!busy) run(api.pauseEngine(engineId));
  }
  function resumeNow() {
    const asked = resume.take();
    if (!asked || busy) return;
    run(asked.then((a) => api.resumeEngine(engineId, a)));
  }
  function disconnect() {
    if (busy) return;
    if (!sync.complete) return setError(m.notLoaded); // the cutoff needs every row of this engine
    const asked = revoke.take(); // the device lock comes first; the list is only built after it
    if (!asked) return;
    run(asked.then(async (assertion) => {
      const accepted = verifyRows(vault.userId, vault.engineList, sync, memoryStore());
      const token = await githubTokenFor(vault, vault.engineList, sync.links.values(), engineId); // sent once, never kept
      const next = revokeList(vault.engineList, engineId, accepted, vault.userId, new Date());
      await api.revokeEngine(engineId, { engine_list: sealRevoked(vault.mk, vault.userId, next), engine_list_version: next.version, ...(token ? { github_token: token } : {}), assertion });
      rememberVersion(browserStore(), vault.userId, next.version);
      setConfirming(false);
      onVault({ ...vault, engineList: next });
    }));
  }

  const state = !live ? m.disconnected : paused ? (server?.pause_reason === "user" ? m.pausedUser : m.pausedAuto) : m.running;
  return (
    <li class="panel" data-engine={engineId}>
      <h3>{entry.name} <span class="badge">{state}</span></h3>
      <p class="small">{m.added(shortDate(entry.added_at))}</p>
      <p class="small">{last ? m.last(shortDate(last.at), last.n) : m.noRecords}</p>
      {live ? (
        <div class="row-actions">
          {paused ? <button type="button" disabled={!resume.ready || busy} onClick={resumeNow}>{m.resume}</button> : <button type="button" disabled={busy} onClick={pause}>{m.pause}</button>}
          {confirming ? null : <button type="button" onClick={() => setConfirming(true)}>{m.disconnect}</button>}
        </div>
      ) : null}
      {confirming ? (
        <div role="group" aria-label={m.disconnect}>
          <p>{m.confirmDisconnect}</p>
          {lastOne ? <p class="small">{m.lastOne}</p> : null}
          <p class="small">{COPY.manage.stepupAhead}</p>
          <div class="row-actions">
            <button type="button" class="primary" disabled={!revoke.ready || busy} onClick={disconnect}>{m.confirmYes}</button>
            <button type="button" onClick={() => setConfirming(false)}>{m.cancel}</button>
          </div>
        </div>
      ) : null}
      <p class="error" role="alert">{error ?? ""}</p>
    </li>
  );
}

/** Section "이 컴퓨터의 기록 도우미" (5.9a): pause, resume, disconnect. Names and keys come from the signed list. */
export function EngineRows(p: Props) {
  const list = p.vault.engineList.engines;
  return (
    <section aria-labelledby="engines-title">
      <h2 id="engines-title">{COPY.manage.engines.title}</h2>
      {liveEngines(p.vault.engineList).length === 0 ? <p>{COPY.manage.engines.none}</p> : null}
      <ul class="plain">{list.map((e) => <Row key={e.engine_id} {...p} engineId={e.engine_id} />)}</ul>
    </section>
  );
}
