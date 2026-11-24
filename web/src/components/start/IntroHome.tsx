import { useState } from "preact/hooks";
import { COPY } from "../../lib/copy";
import { Locked, ServerToggle } from "../ui/ServerToggle";

/** First-screen example of the confirmed home (ADR-0018), with the "what the server sees" switch. */
export function IntroHome() {
  const h = COPY.intro.home;
  const [server, setServer] = useState<boolean>(h.serverFirst);
  return (
    <section class="mini-home" aria-labelledby="home-title">
      <h2 id="home-title">{h.title}</h2>
      <ServerToggle checked={server} label={h.toggle} onChange={setServer} />
      <p class={server ? "server-note on" : "server-note"} aria-live="polite">{server ? h.serverNote : h.deviceNote}</p>
      <div class="mini-card">
        <p class="mini-name"><Locked server={server}>{h.name}</Locked> <span class="lock" role="img" aria-label="잠김">🔒</span></p>
        <p class="mini-dates">{h.labels.first} {h.first} / {h.labels.last} {h.last}</p>
        <p class="mini-note"><Locked server={server}>{h.nameNote}</Locked></p>
        <ol class="mini-bar" aria-label={`단계 ${h.current + 1}/${h.stages.length}`}>
          {h.stages.map((s, i) => (
            <li key={s} class={i <= h.current ? "on" : ""} aria-current={i === h.current ? "step" : undefined}>
              <Locked server={server}>{s}</Locked>
            </li>
          ))}
        </ol>
        <p class="mini-stage">
          <Locked server={server}>
            <strong>{h.stages[h.current]}</strong> · {h.stageRange} · {h.labels.decided} {h.decided} · {h.labels.deferred} {h.deferred} · {h.labels.turn}: {h.turn}
          </Locked>
        </p>
        <ul class="mini-versions">
          {h.versions.map((v) => (
            <li key={v.fp}>
              <span class="mini-when">{v.when}</span>
              <span class="mini-what">
                <Locked server={server}>{v.what}</Locked>
                <span class="mini-file"><Locked server={server}>{h.labels.file}: {v.file}</Locked></span>
              </span>
              <span class="mini-fp">{v.fp}</span>
              <span class={`mini-chain ${v.chain}`}>{h.chain[v.chain as "done" | "pending"]}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
