import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { Checklist as Done } from "../../lib/signup/machine";
import { Checklist } from "./Checklist";

interface Props { step?: number | null; title: string; badge?: string; why?: string; done?: Done; error?: string | null; children?: ComponentChildren }

/** One screen = one title (focused on change, for screen readers), one "why" line, one action. */
export function Screen({ step, title, badge, why, done, error, children }: Props) {
  const h1 = useRef<HTMLHeadingElement>(null);
  useEffect(() => h1.current?.focus(), [title]);
  return (
    <main class="screen">
      {done ? <Checklist done={done} /> : null}
      {step ? <p class="step-no" aria-label={`5단계 중 ${step}단계`}>{step}/5</p> : null}
      <h1 ref={h1} tabIndex={-1}>{title}{badge ? <span class="badge">{badge}</span> : null}</h1>
      {why ? <p class="why">{why}</p> : null}
      {error ? <p class="error" role="alert">{error}</p> : null}
      {children}
    </main>
  );
}
