// Auto-lock (UX: 기본 5분): lock after N minutes without activity. Background tabs may not run timers, so
// check() re-measures when the tab becomes visible. onLock runs at most once.
export const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
const MINUTE_MS = 60_000;

export interface AutoLock { touch(): void; check(): void; stop(): void }

export function startAutoLock(minutes: number, onLock: () => void): AutoLock {
  const limit = minutes * MINUTE_MS;
  let last = Date.now();
  let handle: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  const arm = () => {
    clearTimeout(handle);
    handle = setTimeout(check, Math.max(0, last + limit - Date.now()));
  };
  function check() {
    if (done) return;
    if (Date.now() - last < limit) return arm();
    done = true;
    clearTimeout(handle);
    onLock();
  }
  arm();
  return {
    touch: () => {
      if (done) return;
      last = Date.now();
      arm();
    },
    check,
    stop: () => {
      done = true;
      clearTimeout(handle);
    },
  };
}

interface VisibleDoc extends EventTarget { readonly visibilityState: string }

/** Wire real activity to the lock; returns the unbind function. */
export function bindActivity(win: EventTarget, doc: VisibleDoc, lock: AutoLock): () => void {
  const touch = () => lock.touch();
  const visible = () => { if (doc.visibilityState === "visible") lock.check(); };
  for (const t of ACTIVITY_EVENTS) win.addEventListener(t, touch, { passive: true });
  doc.addEventListener("visibilitychange", visible);
  return () => {
    for (const t of ACTIVITY_EVENTS) win.removeEventListener(t, touch);
    doc.removeEventListener("visibilitychange", visible);
  };
}
