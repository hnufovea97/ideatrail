// bundle.json as the engine writes it to GitHub (spec §12). Only what the version screen needs; the rest is for /verify.
export interface GithubBundle { commitment: string; nonceSealed: string; manifest: boolean }

const HEX64 = /^[0-9a-f]{64}$/;
const B64U = /^[A-Za-z0-9_-]+$/;

export const bundlePath = (recordId: string) => `proofs/${recordId}/bundle.json`;

export function parseBundle(bytes: Uint8Array): GithubBundle | null {
  try {
    const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as { commitment?: unknown; nonce_sealed?: unknown; manifest?: unknown } | null;
    if (typeof raw?.commitment !== "string" || !HEX64.test(raw.commitment)) return null;
    if (typeof raw.nonce_sealed !== "string" || !B64U.test(raw.nonce_sealed)) return null;
    return { commitment: raw.commitment, nonceSealed: raw.nonce_sealed, manifest: raw.manifest === true };
  } catch {
    return null;
  }
}
