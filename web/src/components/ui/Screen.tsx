import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { Checklist as Done } from "../../lib/signup/machine";
import { Checklist } from "./Checklist";

interface Props { step?: number | null; did?: string | null; title: string; mark?: string; focusKey?: string; badge?: string; why?: string; done?: Done; error?: string | null; status?: string | null; children?: ComponentChildren }

/** The screen's error line, for aria-errormessage. */
export const ERROR_ID = "screen-error";
const DID_ID = "screen-did";

/**
 * One screen = one title, one "why" line, one action. The title gets focus when it changes or when
 * `focusKey` does (a new phase inside one step), so screen readers land on the new content. `did` is the
 * short "방금 한 일" line for what the previous step made; the title points to it so it is read with the title.
 */
export function Screen({ step, did, title, mark, focusKey, badge, why, done, error, status, children }: Props) {
  const h1 = useRef<HTMLHeadingElement>(null);
  useEffect(() => h1.current?.focus(), [title, focusKey]);
  return (
    <main class="screen">
      {done ? <Checklist done={done} /> : null}
      {step ? <p class="step-no"><span aria-hidden="true">{step}/5</span><span class="sr-only">5단계 중 {step}단계</span></p> : null}
      {did ? <p class="did" id={DID_ID}>{did}</p> : null}
      <h1 ref={h1} tabIndex={-1} aria-describedby={did ? DID_ID : undefined}>
        {title}
        {mark ? <span aria-hidden="true"> {mark}</span> : null}
        {badge ? <>{" "}<span class="badge">{badge}</span></> : null}
      </h1>
      {why ? <p class="why">{why}</p> : null}
      {/* Live regions stay in the page; only their text changes, so screen readers announce it. */}
      <p class="error" role="alert" id={ERROR_ID}>{error ?? ""}</p>
      {children}
      <p class="small" role="status">{status ?? ""}</p>
    </main>
  );
}
