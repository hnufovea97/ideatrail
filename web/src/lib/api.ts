// Typed client for the API routes the signup pages use (api/src/routes/*). Errors carry only the
// server's error code; screens choose their own sentence (copy.ts), never the server's message.
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class ApiFailure extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = "ApiFailure";
  }
}

const ID = /^[0-9a-hjkmnp-tv-z]{26}$/;
const CODE = /^[a-z_]{1,40}$/;

const id = (s: string): string => {
  if (!ID.test(s)) throw new ApiFailure(0, "bad_id");
  return s;
};

function errorCode(data: unknown): string {
  const code = (data as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === "string" && CODE.test(code) ? code : "unknown";
}

async function call<T>(f: Fetch, base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await f(base + path, {
      method,
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiFailure(0, "offline");
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) throw new ApiFailure(res.status, errorCode(data));
  return data as T;
}

export interface CredentialDescriptorJSON { id: string; type: "public-key"; transports?: string[] }
export interface CreationOptionsJSON {
  challenge: string;
  rp: { id?: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  timeout?: number;
  excludeCredentials?: CredentialDescriptorJSON[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  attestation?: AttestationConveyancePreference;
}
export interface RequestOptionsJSON {
  challenge: string;
  rpId?: string;
  timeout?: number;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: CredentialDescriptorJSON[];
}
export interface RegistrationJSON {
  id: string; rawId: string; type: "public-key"; authenticatorAttachment?: "platform" | "cross-platform"; clientExtensionResults: Record<string, never>;
  response: { clientDataJSON: string; attestationObject: string; transports: string[]; publicKeyAlgorithm?: number; publicKey?: string; authenticatorData?: string };
}
export interface AssertionJSON {
  id: string; rawId: string; type: "public-key"; authenticatorAttachment?: "platform" | "cross-platform"; clientExtensionResults: Record<string, never>;
  response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string };
}
export interface StepupAssertion { challenge_id: string; response: AssertionJSON }

export interface PairingInfo { engine_id: string; sign_pubkey: string; kem_pubkey: string; expires_at: string; delivered: boolean }
export interface RegisterOptions { challenge_id: string; user_id: string; options: CreationOptionsJSON }
export interface EnvelopeUpload { envelope_id: string; wrapped_master_key: string }
export interface RegisterVerifyBody {
  challenge_id: string;
  response: RegistrationJSON;
  account?: { account_pubkey: string; wrapped_account_privkey: string };
  envelope: EnvelopeUpload;
}
export interface AccountInfo { user_id: string; engine_list: string | null; engine_list_version: number; confirmed_at: string | null; recovery_key_status: string }
export interface DeliverBody { payload: string; mac: string; engine_list: string; engine_list_version: number }
export interface RecoveryBody { envelope_id: string; method: "recovery"; wrapped_master_key: string; lookup_hash: string; verify_pubkey: string }
export interface DeviceAddState { joined: boolean; t_pub: string | null; join_mac: string | null; key_uploaded: boolean; used: boolean; expires_at: string }
export interface SealedMessage { msg_id: string; sealed: string }
export interface ApprovalRow { approval_id: string; engine_id: string; kind: string; summary: string; appr_seq: string; engine_sig: string; created_at: string; expires_at: string }
export interface StorageLinkRow { link_id: string; engine_id: string; provider: string; enc_token: string | null; engine_sig: string; created_at: string; revoked_at: string | null }
export interface SyncResponse { changes: { storage_links?: StorageLinkRow[] } & Record<string, unknown>; cursor: number; next_cursor: number | null }

export function createApi(base: string, f: Fetch = (input, init) => fetch(input, init)) {
  const get = <T>(path: string, headers?: Record<string, string>) => call<T>(f, base, "GET", path, undefined, headers);
  const send = <T>(method: "POST" | "PUT", path: string, body: unknown) => call<T>(f, base, method, path, body);
  // Methods that take an id are async so a bad id rejects (like any other ApiFailure) instead of throwing.
  return {
    pairing: async (s: string) => get<PairingInfo>(`/v1/pairing/${id(s)}`),
    registerOptions: (body: { pairing_session_id: string } | { device_add_session_id: string; join_secret: string }) =>
      send<RegisterOptions>("POST", "/v1/webauthn/register/options", body),
    registerVerify: (body: RegisterVerifyBody) => send<{ user_id: string }>("POST", "/v1/webauthn/register/verify", body),
    confirm: () => send<{ confirmed: true }>("POST", "/v1/account/confirm", {}),
    account: () => get<AccountInfo>("/v1/account"),
    deliver: async (s: string, body: DeliverBody) => send<{ engine_id: string; engine_list_version: number }>("POST", `/v1/pairing/${id(s)}/deliver`, body),
    stepupOptions: (method: "POST" | "PUT", path: string) => send<{ challenge_id: string; options: RequestOptionsJSON }>("POST", "/v1/webauthn/stepup/options", { method, path }),
    putRecovery: (body: RecoveryBody & { assertion: StepupAssertion }) => send<{ envelope_id: string }>("PUT", "/v1/envelopes", body),
    deviceAddStart: () => send<{ session_id: string; expires_at: string }>("POST", "/v1/device-add", {}),
    deviceAddState: async (d: string) => get<DeviceAddState>(`/v1/device-add/${id(d)}`),
    deviceAddUpload: async (d: string, body: { sealed_mk: string; mac: string }) => send<{ uploaded: true }>("POST", `/v1/device-add/${id(d)}/key`, body),
    deviceAddJoin: async (d: string, body: { t_pub: string; mac: string }) => send<{ join_secret: string }>("POST", `/v1/device-add/${id(d)}/join`, body),
    deviceAddFetchKey: async (d: string, joinSecret: string) => get<{ user_id: string; sealed_mk: string; mac: string }>(`/v1/device-add/${id(d)}/key`, { "x-it-join-secret": joinSecret }),
    inbox: (body: { engine_id: string } & SealedMessage) => send<{ msg_id: string }>("POST", "/v1/inbox", body),
    approvals: () => get<{ approvals: ApprovalRow[] }>("/v1/approvals"),
    decide: async (approvalId: string, body: { decision: "approved" | "rejected"; message: SealedMessage; assertion: StepupAssertion }) =>
      send<{ approval_id: string; status: string }>("POST", `/v1/approvals/${id(approvalId)}/decide`, body),
    sync: (cursor: number) => get<SyncResponse>(`/v1/sync?cursor=${Math.max(0, Math.floor(cursor))}`),
  };
}

export type Api = ReturnType<typeof createApi>;
