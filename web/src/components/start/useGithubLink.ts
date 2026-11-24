import { useRef, useState } from "preact/hooks";
import type { Api } from "../../lib/api";
import { COPY, errorMessage } from "../../lib/copy";
import { findStorageLink } from "../../lib/github-link";
import { sealInbox } from "../../lib/inbox";
import type { SignupContext } from "../../lib/signup/context";
import { GITHUB_WAIT_MS, POLL_MS } from "../../lib/timing";
import { usePolling } from "../ui/usePolling";

/** Ask the engine to start GitHub device flow, then wait for its signed storage link. */
/** What the link needs from the signup context; the dashboard passes its own vault and first engine. */
export type LinkTarget = Pick<SignupContext, "vault" | "engine" | "kemPub">;

export function useGithubLink(api: Api, ctx: LinkTarget, onLinked: () => void) {
  const [phase, setPhase] = useState<"idle" | "waiting">("idle");
  const [error, setError] = useState<string | null>(null);
  const cursor = useRef(0);
  const started = useRef(0);
  const sending = useRef(false);

  async function start() {
    if (!ctx.vault || !ctx.engine || sending.current || phase === "waiting") return; // one request at a time
    sending.current = true;
    setError(null);
    try {
      const m = await sealInbox(ctx.vault, ctx.kemPub, { type: "connect_github" });
      await api.inbox({ engine_id: ctx.engine.engine_id, ...m });
      started.current = Date.now();
      setPhase("waiting");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      sending.current = false;
    }
  }

  usePolling(phase === "waiting", POLL_MS, async () => {
    if (!ctx.vault || !ctx.engine) return true;
    if (Date.now() - started.current > GITHUB_WAIT_MS) { // checked before trying, so a slow error loop still ends
      setPhase("idle");
      setError(COPY.errors.github_not_done);
      return true;
    }
    try {
      const r = await findStorageLink(api, cursor.current, ctx.engine, ctx.vault.userId);
      cursor.current = r.cursor;
      setError(null);
      if (r.linked) {
        onLinked();
        return true;
      }
      return false;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  }, [phase], (e) => setError(errorMessage(e)));

  return { phase, error, start };
}
