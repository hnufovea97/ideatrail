import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { Api, StepupAssertion, StepupMethod } from "../../lib/api";
import { confirmWithPasskey, prepareStepup, type PreparedStepup } from "../../lib/stepup";
import { STEPUP_REFRESH_MS } from "../../lib/timing";

/**
 * A step-up challenge kept ready for one action (`path` null = not needed yet). It is fetched before the click and
 * renewed before it expires. `take()` must be called straight from the click: it asks for the device lock at once
 * and returns the assertion, then a fresh challenge is fetched (challenges are single-use). Null = not ready.
 */
export function useStepup(api: Api, method: StepupMethod, path: string | null) {
  const [prepared, setPrepared] = useState<PreparedStepup | null>(null);
  const alive = useRef(true);
  const current = useRef(path);
  current.current = path;

  const load = useCallback(() => {
    if (!path) return;
    void prepareStepup(api, method, path).then(
      (p) => { if (alive.current && current.current === path) setPrepared(p); },
      () => { if (alive.current && current.current === path) setPrepared(null); },
    );
  }, [api, method, path]);

  useEffect(() => {
    alive.current = true;
    setPrepared(null);
    if (!path) return () => { alive.current = false; };
    load();
    const t = setInterval(load, STEPUP_REFRESH_MS);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [path, load]);

  const take = (): Promise<StepupAssertion> | null => {
    if (!prepared) return null;
    const asked = confirmWithPasskey(prepared); // first call in the click: no await before it
    setPrepared(null);
    const renew = () => load();
    asked.then(renew, renew);
    return asked;
  };
  return { ready: prepared !== null, take };
}
