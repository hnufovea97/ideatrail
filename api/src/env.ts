export interface Bindings {
  DB: D1Database;
  IP_LIMITER: RateLimit;
  RP_ID: string;
  RP_NAME: string;
  APP_ORIGIN: string;
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: { userId?: string; engineId?: string };
};
