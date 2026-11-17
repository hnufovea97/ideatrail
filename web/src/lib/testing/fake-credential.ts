// vitest only — never import from app code.
const buf = (n: number, fill: number) => new Uint8Array(n).fill(fill).buffer;

/** A PublicKeyCredential-shaped object for unit tests (Node has no WebAuthn). */
export function fakeCredential(opts: { prf?: Uint8Array | null; kind?: "create" | "get"; rawId?: number } = {}): PublicKeyCredential {
  const rawId = buf(16, opts.rawId ?? 1);
  const results = opts.prf ? { prf: { enabled: true, results: { first: opts.prf.slice().buffer } } } : { prf: { enabled: false } };
  const response = opts.kind === "get"
    ? { clientDataJSON: buf(8, 2), authenticatorData: buf(37, 3), signature: buf(70, 4), userHandle: null }
    : { clientDataJSON: buf(8, 2), attestationObject: buf(64, 5), getTransports: () => ["internal"], getPublicKeyAlgorithm: () => -7, getPublicKey: () => buf(91, 6), getAuthenticatorData: () => buf(37, 3) };
  return { id: "AQEBAQEBAQEBAQEBAQEBAQ", rawId, type: "public-key", authenticatorAttachment: "platform", getClientExtensionResults: () => results, response } as unknown as PublicKeyCredential;
}
