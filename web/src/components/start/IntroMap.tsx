import type { JSX } from "preact";
import { COPY } from "../../lib/copy";

type Key = (typeof COPY.intro.map)[number]["key"];

/** Small line icons drawn as SVG paths (no images, no network); decorative, the text says it all. */
const ICONS: Record<Key, JSX.Element> = {
  pc: <><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M8 20h8M12 16v4" /></>,
  phone: <><rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M11 18.5h2" /></>,
  github: <><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10h14V9M10 13h4" /></>,
  recovery: <><path d="M6 3h9l3 3v15H6z" /><path d="M9 11h6M9 15h6" /></>,
};

/** Step 0's map: the four things the signup makes and where each one lives. */
export function IntroMap() {
  return (
    <section class="map" aria-labelledby="map-title">
      <h2 id="map-title">{COPY.intro.mapTitle}</h2>
      <ul>
        {COPY.intro.map.map((m) => (
          <li key={m.key}>
            <svg class="map-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">{ICONS[m.key]}</svg>
            <span class="map-name">{m.name}</span>
            <span class="map-where">{m.where}</span>
            <span class="map-note">{m.note}</span>
          </li>
        ))}
      </ul>
      <p class="map-server">{COPY.intro.server}</p>
    </section>
  );
}
