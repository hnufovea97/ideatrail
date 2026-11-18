import type { Api } from "../../lib/api";
import { COPY } from "../../lib/copy";
import type { SignupContext } from "../../lib/signup/context";
import { useGithubLink } from "./useGithubLink";

export function GithubBanner({ api, ctx, onLinked }: { api: Api; ctx: SignupContext; onLinked: () => void }) {
  const { phase, error, start } = useGithubLink(api, ctx, onLinked);
  return (
    <section class="banner" aria-label={COPY.github.title}>
      <p>{COPY.github.banner}</p>
      {phase === "waiting" ? null : <button type="button" onClick={start}>{COPY.github.bannerAction}</button>}
      <p class="small" role="status">{phase === "waiting" ? COPY.github.waiting : ""}</p>
      <p class="error" role="alert">{error ?? ""}</p>
    </section>
  );
}
