import { useState } from "preact/hooks";
import { COPY } from "../../lib/copy";

/** Clipboard only — nothing is sent anywhere. */
export function CopyButton({ text, label = COPY.actions.copy }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard.writeText(text).then(() => setCopied(true), () => setCopied(false));
  return (
    <>
      <button type="button" onClick={copy}>{label}</button>
      <p class="small" aria-live="polite">{copied ? COPY.actions.copied : ""}</p>
    </>
  );
}
