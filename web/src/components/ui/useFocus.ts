import { useEffect, useRef } from "preact/hooks";

/** A heading that takes focus when its view appears, so screen readers land on the new content (as `Screen` does for its h1). */
export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => ref.current?.focus(), []);
  return ref;
}
