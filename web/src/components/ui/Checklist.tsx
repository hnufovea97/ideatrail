import { CHECKLIST } from "../../lib/copy";
import type { Checklist as Done } from "../../lib/signup/machine";

export function Checklist({ done }: { done: Done }) {
  return (
    <ol class="checklist" aria-label="필요한 것 5가지">
      {CHECKLIST.map((item) => (
        <li key={item.key} class={done[item.key] ? "done" : ""}>
          <span aria-hidden="true">{done[item.key] ? "✓" : "·"}</span> {item.label}
          {done[item.key] ? <span class="sr-only"> (끝냄)</span> : null}
        </li>
      ))}
    </ol>
  );
}
