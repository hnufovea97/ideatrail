export interface Bindings {
  DB: D1Database;
  IP_LIMITER: RateLimit;
  RP_ID: string;
  RP_NAME: string;
  APP_ORIGIN: string;
  /** "1" only in the vitest config: enables /v1/__test/* routes. */
  TEST_ROUTES?: string;
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: { userId?: string; engineId?: string };
};
