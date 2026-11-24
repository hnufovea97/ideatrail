import type { ComponentChildren } from "preact";

/** Text that exists on the Ideatrail server only locked: blurred and hidden from screen readers in server view (ADR-0018). */
export function Locked({ server, children }: { server: boolean; children: ComponentChildren }) {
  return (
    <span data-testid="locked" class={server ? "locked blur" : "locked"} aria-hidden={server ? "true" : undefined}>
      {children}
    </span>
  );
}

interface Props { checked: boolean; label: string; onChange(on: boolean): void }

/** The "Ideatrail 서버가 가진 데이터" checkbox with the red hand-drawn circle while it is on. Display only. */
export function ServerToggle({ checked, label, onChange }: Props) {
  return (
    <label class="server-toggle">
      <span class="cbx">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
        {checked ? (
          <svg class="mark" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
            <path pathLength={1} d="M9 23 C 6 11, 19 4, 29 8 C 37 12, 38 26, 31 33 C 23 39, 9 37, 6 27 C 4 19, 11 11, 21 9" />
          </svg>
        ) : null}
      </span>
      <span>{label}</span>
    </label>
  );
}
