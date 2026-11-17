import { describe, expect, it } from "vitest";
import { prfSupport } from "./capability";

const env = (caps: unknown, secure = true) => ({ isSecureContext: secure, PublicKeyCredential: caps === undefined ? undefined : { getClientCapabilities: async () => caps as Record<string, boolean | undefined> } });

describe("PRF capability check (UX ⑤ 0-1)", () => {
  it("yes / no / unknown from getClientCapabilities", async () => {
    expect(await prfSupport(env({ "extension:prf": true }))).toBe("yes");
    expect(await prfSupport(env({ "extension:prf": false }))).toBe("no");
    expect(await prfSupport(env({}))).toBe("unknown");
  });
  it("no WebAuthn or not a secure context → no", async () => {
    expect(await prfSupport(env(undefined))).toBe("no");
    expect(await prfSupport(env({ "extension:prf": true }, false))).toBe("no");
  });
  it("older browsers without getClientCapabilities → unknown (the real check is at create)", async () => {
    expect(await prfSupport({ isSecureContext: true, PublicKeyCredential: {} })).toBe("unknown");
  });
});
