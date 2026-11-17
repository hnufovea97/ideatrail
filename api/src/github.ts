import type { Bindings } from "./env";

export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 10_000;

/**
 * Revoke one GitHub App user token (api-index: engine disconnect). Uses the app's client id/secret
 * from Worker vars/secrets. Never logs the token; returns only success/failure.
 */
export async function revokeGithubToken(env: Bindings, token: string, fetcher: Fetcher = fetch): Promise<boolean> {
  if (!env.GITHUB_APP_CLIENT_ID || !env.GITHUB_APP_CLIENT_SECRET) return false;
  try {
    const res = await fetcher(`https://api.github.com/applications/${encodeURIComponent(env.GITHUB_APP_CLIENT_ID)}/token`, {
      method: "DELETE",
      headers: {
        authorization: `Basic ${btoa(`${env.GITHUB_APP_CLIENT_ID}:${env.GITHUB_APP_CLIENT_SECRET}`)}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "ideatrail-api",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({ access_token: token }),
      redirect: "manual", // Workers rejects "error"; manual = never follow
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.status === 204 || res.status === 404; // 404: already gone
  } catch {
    return false;
  }
}
