// vitest only — never import from app code. Answers the Git Data API calls mirror/github.ts makes and records them.
import type { Fetch } from "../api";

export interface GithubCall { method: string; path: string; body: unknown; auth: string | null }

export function fakeGithub(o: { repoId?: number; isPrivate?: boolean; refConflicts?: number } = {}) {
  const calls: GithubCall[] = [];
  let conflictsLeft = o.refConflicts ?? 0;
  let n = 0;
  const sha = () => (++n).toString(16).padStart(40, "0");
  const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
  const fetch: Fetch = async (input, init) => {
    const { pathname: p } = new URL(input);
    const method = init?.method ?? "GET";
    calls.push({ method, path: p, body: init?.body ? JSON.parse(String(init.body)) : null, auth: new Headers(init?.headers).get("authorization") });
    if (method === "GET" && /^\/repos\/[^/]+\/[^/]+$/.test(p)) return ok({ id: o.repoId ?? 42, private: o.isPrivate ?? true, default_branch: "main" });
    if (method === "GET" && p.endsWith("/git/ref/heads/main")) return ok({ object: { sha: sha() } });
    if (method === "GET" && p.includes("/git/commits/")) return ok({ tree: { sha: sha() } });
    if (method === "POST" && /\/git\/(blobs|trees|commits)$/.test(p)) return ok({ sha: sha() });
    if (method === "PATCH" && p.endsWith("/git/refs/heads/main")) {
      if (conflictsLeft > 0) {
        conflictsLeft--;
        return new Response("{}", { status: 422 });
      }
      return ok({ object: { sha: sha() } });
    }
    return new Response("{}", { status: 404 });
  };
  return { calls, fetch };
}
