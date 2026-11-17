import type { MiddlewareHandler } from "hono";
import { ApiError } from "./errors";
import type { AppEnv, Bindings } from "../env";

/** Returns true when the call is allowed. */
export interface Limiter {
  allow(key: string): Promise<boolean>;
}

/** Workers Rate Limiting binding (approximate, per location — fine for abuse damping). */
export const bindingLimiter = (env: Bindings): Limiter => ({
  allow: async (key) => (await env.IP_LIMITER.limit({ key })).success,
});

/** Per-route, per-IP limit for unauthenticated routes. The route name keeps routes independent. */
export const ipLimit = (route: string, getLimiter: (env: Bindings) => Limiter): MiddlewareHandler<AppEnv> => async (c, next) => {
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  if (!(await getLimiter(c.env).allow(`${route}:${ip}`))) throw new ApiError(429, "rate_limited", "Too many requests; try again shortly");
  await next();
};
