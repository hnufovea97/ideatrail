import { useEffect, useRef } from "preact/hooks";

/**
 * Run `tick` now and every `ms` while `active`; stop for good once it resolves true. Never overlaps.
 * Ticks report their own errors on screen and resolve; an unexpected throw goes to `onError` (so it is
 * shown, not swallowed) and polling carries on.
 */
export function usePolling(active: boolean, ms: number, tick: () => Promise<boolean>, deps: unknown[], onError: (e: unknown) => void): void {
  const fn = useRef(tick);
  fn.current = tick;
  const report = useRef(onError);
  report.current = onError;
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let running = false;
    const run = async () => {
      if (stopped || running) return;
      running = true;
      try {
        if (await fn.current()) stopped = true;
      } catch (e) {
        if (!stopped) report.current(e);
      } finally {
        running = false;
      }
    };
    void run();
    const t = setInterval(run, ms);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [active, ms, ...deps]);
}
