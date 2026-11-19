import type { JSX } from "preact";
import { COPY } from "../../lib/copy";

type Key = (typeof COPY.intro.benefits)[number]["key"];

/** Decorative line icons (SVG paths, no network); the text carries the meaning. */
const ICONS: Record<Key, JSX.Element> = {
  say: <><path d="M4 5h16v11H9l-5 4z" /><path d="M8 10h8" /></>,
  find: <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></>,
  safe: <><rect x="5" y="10" width="14" height="10" rx="1.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
};

/** Step 0's pitch: one familiar scene, what it looks like later, then three benefits. */
export function IntroPitch() {
  const ex = COPY.intro.example;
  return (
    <>
      <section class="pitch-example" aria-labelledby="example-title">
        <h2 id="example-title">{COPY.intro.exampleTitle}</h2>
        <p class="bubble say">{ex.say}</p>
        <p class="bubble reply">{ex.reply}</p>
        <p class="later-title">{ex.laterTitle}</p>
        <ol class="later">
          {ex.later.map((l) => (
            <li key={l.when}>
              <span class="later-stage">{l.stage}</span> <span class="later-when">{l.when}</span>
              {l.chose ? <span class="later-chose">{l.chose}</span> : null}
            </li>
          ))}
        </ol>
      </section>
      <section class="benefits" aria-labelledby="benefits-title">
        <h2 id="benefits-title">{COPY.intro.benefitsTitle}</h2>
        <ul>
          {COPY.intro.benefits.map((b) => (
            <li key={b.key}>
              <svg class="benefit-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">{ICONS[b.key]}</svg>
              <span class="benefit-head">{b.head}</span>
              <span class="benefit-body">{b.body}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
