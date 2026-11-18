import { useState } from "preact/hooks";
import { COPY } from "../../lib/copy";

/** Clipboard only — nothing is sent anywhere. The status line is always there; only its text changes. */
export function CopyButton({ text, label = COPY.actions.copy }: { text: string; label?: string }) {
  const [result, setResult] = useState<"idle" | "ok" | "fail">("idle");
  const copy = () => {
    const clip = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (typeof clip?.writeText !== "function") return setResult("fail"); // insecure context or old browser
    clip.writeText(text).then(() => setResult("ok"), () => setResult("fail"));
  };
  const said = result === "ok" ? COPY.actions.copied : result === "fail" ? COPY.actions.copyFailed : "";
  return (
    <>
      <button type="button" onClick={copy}>{label}</button>
      <p class="small" role="status">{said}</p>
    </>
  );
}
