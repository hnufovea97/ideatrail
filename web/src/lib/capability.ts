export type PrfSupport = "yes" | "no" | "unknown";

export interface CapabilityEnv {
  isSecureContext: boolean;
  PublicKeyCredential?: { getClientCapabilities?: () => Promise<Record<string, boolean | undefined>> };
}

/** Before the first screen (UX ⑤ 0-1). "unknown" proceeds: create()/get() results are the real test. */
export async function prfSupport(env: CapabilityEnv): Promise<PrfSupport> {
  const pkc = env.PublicKeyCredential;
  if (!pkc || !env.isSecureContext) return "no";
  if (typeof pkc.getClientCapabilities !== "function") return "unknown";
  try {
    const v = (await pkc.getClientCapabilities())["extension:prf"];
    return v === true ? "yes" : v === false ? "no" : "unknown";
  } catch {
    return "unknown";
  }
}
