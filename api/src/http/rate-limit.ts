import type { MiddlewareHandler } from "hono";
import { ApiError } from "./errors";
import type { AppEnv, Bindings } from "../env";

/** "ip": strict per-IP limit for unauthenticated routes. "write": per-account limit for browser writes. */
export type LimitKind = "ip" | "write";

/** Returns true when the call is allowed. */
export interface Limiter {
  allow(key: string, kind?: LimitKind): Promise<boolean>;
}

/** Workers Rate Limiting bindings (approximate, per location — fine for abuse damping). */
export const bindingLimiter = (env: Bindings): Limiter => ({
  allow: async (key, kind = "ip") => (await (kind === "write" ? env.WRITE_LIMITER : env.IP_LIMITER).limit({ key })).success,
});

/** Per-route, per-IP limit for unauthenticated routes. The route name keeps routes independent. */
/**
 * Per-account write limit for browser writes (protects the shared D1 write budget). Use after a
 * session middleware; engine requests are already counted by the engine quota and pass through.
 */
export const userWriteLimit = (getLimiter: (env: Bindings) => Limiter): MiddlewareHandler<AppEnv> => async (c, next) => {
  const userId = c.get("userId");
  if (userId && !c.get("engineId") && !(await getLimiter(c.env).allow(`write:${userId}`, "write"))) {
    throw new ApiError(429, "rate_limited", "Too many changes; try again shortly");
  }
  await next();
};

export const ipLimit = (route: string, getLimiter: (env: Bindings) => Limiter): MiddlewareHandler<AppEnv> => async (c, next) => {
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  if (!(await getLimiter(c.env).allow(`${route}:${ip}`))) throw new ApiError(429, "rate_limited", "Too many requests; try again shortly");
  await next();
};
