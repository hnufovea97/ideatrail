import { Hono } from "hono";
import type { AppEnv } from "./env";
import { notFound, onError } from "./http/errors";
import { appCors, limitBody, safeLogger, securityHeaders } from "./http/middleware";

export function createApp() {
  const app = new Hono<AppEnv>();
  app.use("*", safeLogger, securityHeaders, appCors, limitBody);
  app.onError(onError);
  app.notFound(notFound);

  app.all("/v1/__test/throw", (c) => {
    if (c.env.TEST_ROUTES !== "1") return notFound(c);
    throw new Error("boom-detail");
  });
  app.post("/v1/__test/echo", async (c) => {
    if (c.env.TEST_ROUTES !== "1") return notFound(c);
    return c.json({ size: (await c.req.arrayBuffer()).byteLength });
  });
  return app;
}

const app = createApp();
export default { fetch: app.fetch } satisfies ExportedHandler<AppEnv["Bindings"]>;
