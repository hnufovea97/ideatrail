import { useRef, useState } from "preact/hooks";
import type { Api } from "../../lib/api";
import { COPY, errorMessage } from "../../lib/copy";
import { findStorageLink } from "../../lib/github-link";
import { sealInbox } from "../../lib/inbox";
import type { SignupContext } from "../../lib/signup/context";
import { GITHUB_WAIT_MS, POLL_MS } from "../../lib/timing";
import { usePolling } from "../ui/usePolling";

/** Ask the engine to start GitHub device flow, then wait for its signed storage link. */
export function useGithubLink(api: Api, ctx: SignupContext, onLinked: () => void) {
  const [phase, setPhase] = useState<"idle" | "waiting">("idle");
  const [error, setError] = useState<string | null>(null);
  const cursor = useRef(0);
  const started = useRef(0);

  async function start() {
    if (!ctx.vault || !ctx.engine) return;
    setError(null);
    try {
      const m = await sealInbox(ctx.vault, ctx.kemPub, { type: "connect_github" });
      await api.inbox({ engine_id: ctx.engine.engine_id, ...m });
      started.current = Date.now();
      setPhase("waiting");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  usePolling(phase === "waiting", POLL_MS, async () => {
    if (!ctx.vault || !ctx.engine) return true;
    try {
      const r = await findStorageLink(api, cursor.current, ctx.engine, ctx.vault.userId);
      cursor.current = r.cursor;
      if (r.linked) {
        onLinked();
        return true;
      }
      if (Date.now() - started.current > GITHUB_WAIT_MS) {
        setPhase("idle");
        setError(COPY.errors.github_not_done);
        return true;
      }
      return false;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  }, [phase]);

  return { phase, error, start };
}
