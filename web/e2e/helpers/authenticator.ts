import type { CDPSession, Page } from "@playwright/test";

export interface VirtualAuthenticator { cdp: CDPSession; id: string; count(): Promise<number> }

/** CDP virtual authenticator (platform, UV, resident keys); hasPrf switches the PRF extension. */
export async function addAuthenticator(page: Page, { prf }: { prf: boolean }): Promise<VirtualAuthenticator> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const options = {
    protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal",
    hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: prf,
  };
  // hasPrf is newer than Playwright's bundled protocol typings
  const { authenticatorId } = (await cdp.send("WebAuthn.addVirtualAuthenticator", { options } as never)) as { authenticatorId: string };
  return {
    cdp,
    id: authenticatorId,
    count: async () => ((await cdp.send("WebAuthn.getCredentials", { authenticatorId })) as { credentials: unknown[] }).credentials.length,
  };
}
