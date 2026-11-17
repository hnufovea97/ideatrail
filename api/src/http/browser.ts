import type { MiddlewareHandler } from "hono";
import { ApiError } from "./errors";
import type { AppEnv } from "../env";

/**
 * CSRF defence for every browser write (non-GET, cookie-based or creating a session):
 * Origin must be exactly APP_ORIGIN (a missing Origin is rejected) and the body must be JSON,
 * which forces a CORS preflight for any cross-origin page. Engine-signed routes do not use this.
 */
export const browserWrite: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    if (c.req.header("origin") !== c.env.APP_ORIGIN) throw new ApiError(403, "bad_origin", "Request origin not allowed");
    const type = c.req.header("content-type") ?? "";
    if (!type.toLowerCase().startsWith("application/json")) throw new ApiError(415, "json_required", "Content-Type must be application/json");
  }
  await next();
};
