export interface Bindings {
  DB: D1Database;
  IP_LIMITER: RateLimit;
  WRITE_LIMITER: RateLimit;
  RP_ID: string;
  RP_NAME: string;
  APP_ORIGIN: string;
  /** GitHub App (vars) and its secret (wrangler secret) — used only to revoke tokens. */
  GITHUB_APP_CLIENT_ID?: string;
  GITHUB_APP_CLIENT_SECRET?: string;
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: { userId?: string; engineId?: string };
};
