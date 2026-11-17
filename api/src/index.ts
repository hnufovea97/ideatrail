import { Hono } from "hono";
import type { AppEnv, Bindings } from "./env";
import { notFound, onError } from "./http/errors";
import { appCors, limitBody, safeLogger, securityHeaders } from "./http/middleware";
import { bindingLimiter, type Limiter } from "./http/rate-limit";
import { requireConfirmed } from "./auth/session";
import { webauthnRoutes } from "./routes/webauthn";
import { accountRoutes } from "./routes/account";

export interface AppDeps {
  /** Rate limiter factory; tests inject a fake. */
  limiter?: (env: Bindings) => Limiter;
}

export function createApp(deps: AppDeps = {}) {
  const limiter = deps.limiter ?? bindingLimiter;
  const app = new Hono<AppEnv>();
  app.use("*", safeLogger, securityHeaders, appCors, limitBody);
  app.onError(onError);
  app.notFound(notFound);

  app.route("/v1/webauthn", webauthnRoutes(limiter));
  app.route("/v1/account", accountRoutes());

  testRoutes(app);
  return app;
}

/** Routes that exist only when TEST_ROUTES=1 (vitest config). */
function testRoutes(app: Hono<AppEnv>) {
  app.all("/v1/__test/throw", (c) => {
    if (c.env.TEST_ROUTES !== "1") return notFound(c);
    throw new Error("boom-detail");
  });
  app.post("/v1/__test/echo", async (c) => {
    if (c.env.TEST_ROUTES !== "1") return notFound(c);
    return c.json({ size: (await c.req.arrayBuffer()).byteLength });
  });
  app.get("/v1/__test/confirmed-only", async (c, next) => (c.env.TEST_ROUTES === "1" ? requireConfirmed(c, next) : notFound(c)), (c) => c.json({ ok: true }));
}

const app = createApp();
export default { fetch: app.fetch } satisfies ExportedHandler<Bindings>;
