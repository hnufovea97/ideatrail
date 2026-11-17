import type { Api, RequestOptionsJSON, StepupAssertion } from "./api";
import { assertWithPasskey } from "./webauthn";

export interface PreparedStepup { challenge_id: string; options: RequestOptionsJSON; at: number }

/** Fetch the 2-minute step-up challenge BEFORE the click (Safari needs create/get first in the handler). */
export const prepareStepup = async (api: Api, method: "POST" | "PUT", path: string): Promise<PreparedStepup> =>
  ({ ...(await api.stepupOptions(method, path)), at: Date.now() });

/** Call from the click handler. */
export const confirmWithPasskey = (p: PreparedStepup): Promise<StepupAssertion> =>
  assertWithPasskey(p.options).then((response) => ({ challenge_id: p.challenge_id, response }));
