import { Hono } from "hono";
import type { AppEnv, Bindings } from "./env";
import { notFound, onError } from "./http/errors";
import { appCors, limitBody, safeLogger, securityHeaders } from "./http/middleware";
import { bindingLimiter, type Limiter } from "./http/rate-limit";
import { requireConfirmed, requireSession } from "./auth/session";
import { webauthnRoutes } from "./routes/webauthn";
import { pairingRoutes } from "./routes/pairing";
import { deviceAddRoutes } from "./routes/device-add";
import { envelopeRoutes, recoveryRoutes } from "./routes/recovery";
import { recordRoutes } from "./routes/records";
import { deltaRoutes } from "./routes/deltas";
import { anchorRoutes, importAllowanceRoutes, repoHeadRoutes, storageLinkRoutes } from "./routes/anchors";
import { accountRoutes, logoutHandlers } from "./routes/account";
import { requireStepup } from "./auth/stepup";

export interface AppDeps {
  /** Rate limiter factory; tests inject a fake. */
  limiter?: (env: Bindings) => Limiter;
  /** Register /v1/__test/* helper routes. Only tests set this; the deployed entry never does. */
  testRoutes?: boolean;
}

export function createApp(deps: AppDeps = {}) {
  const limiter = deps.limiter ?? bindingLimiter;
  const app = new Hono<AppEnv>();
  app.use("*", safeLogger, securityHeaders, appCors, limitBody);
  app.onError(onError);
  app.notFound(notFound);

  app.route("/v1/webauthn", webauthnRoutes(limiter));
  app.route("/v1/account", accountRoutes());
  app.route("/v1/pairing", pairingRoutes(limiter));
  app.route("/v1/device-add", deviceAddRoutes(limiter));
  app.route("/v1/envelopes", envelopeRoutes());
  app.route("/v1/recovery", recoveryRoutes(limiter));
  app.route("/v1/records", recordRoutes());
  app.route("/v1/deltas", deltaRoutes());
  app.route("/v1/anchors", anchorRoutes());
  app.route("/v1/storage-link", storageLinkRoutes());
  app.route("/v1/repo-heads", repoHeadRoutes());
  app.route("/v1/import-allowance", importAllowanceRoutes());
  app.post("/v1/logout", ...logoutHandlers);

  if (deps.testRoutes) testRoutes(app);
  return app;
}

/** Helper routes for tests only (see AppDeps.testRoutes). */
function testRoutes(app: Hono<AppEnv>) {
  app.all("/v1/__test/throw", () => {
    throw new Error("boom-detail");
  });
  app.post("/v1/__test/echo", async (c) => c.json({ size: (await c.req.arrayBuffer()).byteLength }));
  app.post("/v1/__test/stepup", requireSession, requireStepup, (c) => c.json({ ok: true }));
  app.get("/v1/__test/confirmed-only", requireConfirmed, (c) => c.json({ ok: true }));
}

const app = createApp();
export default { fetch: app.fetch } satisfies ExportedHandler<Bindings>;
