import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { errorBody } from "./errors";
import type { AppEnv } from "../env";

export const MAX_BODY_BYTES = 64 * 1024;

export const limitBody = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => c.json(errorBody("payload_too_large", "Request body is over 64KB"), 413),
});

/**
 * One line per request: method, route pattern, status, ms.
 * The route pattern (`/v1/pairing/:id`) hides ids that act as bearer secrets; body, headers,
 * cookies and query strings are never logged.
 */
export const safeLogger: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  await next();
  console.log(JSON.stringify({ m: c.req.method, r: c.req.routePath, s: c.res.status, ms: Date.now() - start }));
};

export const appCors: MiddlewareHandler<AppEnv> = (c, next) =>
  cors({
    origin: (origin) => (origin === c.env.APP_ORIGIN ? origin : null),
    credentials: true,
    allowHeaders: ["content-type", "x-it-join-secret"],
    allowMethods: ["GET", "POST", "PUT", "DELETE"],
    maxAge: 600,
  })(c, next);

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("x-content-type-options", "nosniff");
  c.header("cache-control", "no-store");
  c.header("referrer-policy", "no-referrer");
};
