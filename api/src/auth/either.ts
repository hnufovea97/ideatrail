import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { browserWrite } from "../http/browser";
import { requireEngine } from "./engine-sig";
import { requireConfirmed } from "./session";
import { requireEngineAccount } from "../routes/engine-common";

/**
 * Routes callable by an engine or by the signed-in browser. If X-IT-Engine is present the request is
 * judged ONLY as an engine request (a bad signature is a 401, never a fallback to the cookie).
 * Browser writes still pass the Origin/JSON check; both need a confirmed account.
 */
export const engineOrSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.header("x-it-engine") !== undefined) {
    await requireEngine(c, async () => {
      await requireEngineAccount(c, next);
    });
    return;
  }
  await browserWrite(c, async () => {
    await requireConfirmed(c, next);
  });
};

/** True when the current request was authenticated as an engine. */
export const isEngine = (c: { get(key: "engineId"): string | undefined }) => c.get("engineId") !== undefined;
