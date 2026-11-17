import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { ApiError } from "../http/errors";
import { zId } from "../http/validate";
import { guard, runBatch } from "../db/change";
import type { AppEnv } from "../env";
import { consumeChallenge } from "./challenges";
import { verifyAssertion } from "./webauthn";

const zAssertion = z.object({
  assertion: z.object({ challenge_id: zId, response: z.custom<AuthenticationResponseJSON>((v) => typeof v === "object" && v !== null) }),
});

const stepupRequired = () => new ApiError(401, "stepup_required", "Confirm with your passkey");

/** "METHOD /path" — what a step-up challenge is bound to. */
export const actionOf = (method: string, path: string) => `${method.toUpperCase()} ${path}`;

/**
 * Protected writes: the JSON body carries `assertion` for a step-up challenge issued to THIS user
 * for THIS exact method + path within 2 minutes. Use after requireSession.
 */
export const requireStepup: MiddlewareHandler<AppEnv> = async (c, next) => {
  let parsed: z.infer<typeof zAssertion>;
  try {
    parsed = zAssertion.parse(await c.req.json());
  } catch {
    throw stepupRequired();
  }
  const userId = c.get("userId");
  if (!userId) throw stepupRequired();
  let ch;
  try {
    ch = await consumeChallenge(c.env.DB, parsed.assertion.challenge_id, ["stepup"], userId);
  } catch {
    throw stepupRequired();
  }
  if (ch.action !== actionOf(c.req.method, new URL(c.req.url).pathname)) throw stepupRequired();
  let touch;
  try {
    ({ touch } = await verifyAssertion(c.env, parsed.assertion.response, ch.challenge, userId));
  } catch {
    throw stepupRequired();
  }
  await runBatch(c.env.DB, [touch, guard(c.env.DB)], stepupRequired());
  await next();
};
