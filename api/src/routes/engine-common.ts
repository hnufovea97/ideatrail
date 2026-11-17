import type { MiddlewareHandler } from "hono";
import { ApiError } from "../http/errors";
import type { AppEnv } from "../env";

/** Same answer whether the id is someone else's or a clash with different content (no existence oracle). */
export const idConflict = () => new ApiError(409, "id_conflict", "This id is already used with different content");

export const isConstraintError = (err: unknown) => err instanceof Error && /UNIQUE|PRIMARY KEY/.test(err.message);

/** After requireEngine: the engine's account must have finished signup (spec §11, QA S5). */
export const requireEngineAccount: MiddlewareHandler<AppEnv> = async (c, next) => {
  const confirmed = await c.env.DB.prepare("SELECT confirmed_at FROM users WHERE user_id = ?").bind(c.get("userId")).first("confirmed_at");
  if (!confirmed) throw new ApiError(403, "account_unconfirmed", "Finish signup in the browser first");
  await next();
};
