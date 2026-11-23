import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { COPY } from "../../lib/copy";

/** Text that exists on the Ideatrail server only locked: blurred and hidden from screen readers in server view. */
function Locked({ server, children }: { server: boolean; children: ComponentChildren }) {
  return (
    <span data-testid="locked" class={server ? "locked blur" : "locked"} aria-hidden={server ? "true" : undefined}>
      {children}
    </span>
  );
}

/** First-screen example of the confirmed home (ADR-0018), with the "what the server sees" switch. */
export function IntroHome() {
  const h = COPY.intro.home;
  const [server, setServer] = useState<boolean>(h.serverFirst);
  return (
    <section class="mini-home" aria-labelledby="home-title">
      <h2 id="home-title">{h.title}</h2>
      <label class="server-toggle">
        <span class="cbx">
          <input type="checkbox" checked={server} onChange={(e) => setServer(e.currentTarget.checked)} />
          {server ? (
            <svg class="mark" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
              <path pathLength={1} d="M9 23 C 6 11, 19 4, 29 8 C 37 12, 38 26, 31 33 C 23 39, 9 37, 6 27 C 4 19, 11 11, 21 9" />
            </svg>
          ) : null}
        </span>
        <span>{h.toggle}</span>
      </label>
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
