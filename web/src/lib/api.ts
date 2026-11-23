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

/** Only "no answer" (offline, timeout) and 5xx may go away by trying again; 4xx and bad data will not. */
export const isRetryable = (e: unknown): boolean =>
  e instanceof ApiFailure && e.code !== "bad_id" && (e.status === 0 || e.status >= 500);

type Fields = Record<string, unknown>;
type Check = (d: Fields) => boolean;
const isObject = (d: unknown): d is Fields => typeof d === "object" && d !== null && !Array.isArray(d);
const isCount = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;

async function call<T>(f: Fetch, base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}, check?: Check): Promise<T> {
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
  if (!isObject(data) || (check && !check(data))) throw new ApiFailure(res.status, "bad_response");
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
export interface AccountInfo {
  user_id: string; engine_list: string | null; engine_list_version: number; confirmed_at: string | null; recovery_key_status: string;
  account_pubkey?: string | null; wrapped_account_privkey?: string | null; auto_lock_minutes?: number;
}
export interface DeliverBody { payload: string; mac: string; engine_list: string; engine_list_version: number }
export interface RecoveryBody { envelope_id: string; method: "recovery"; wrapped_master_key: string; lookup_hash: string; verify_pubkey: string }
export interface DeviceAddState { joined: boolean; t_pub: string | null; join_mac: string | null; key_uploaded: boolean; used: boolean; expires_at: string }
export interface SealedMessage { msg_id: string; sealed: string }
export interface ApprovalRow { approval_id: string; engine_id: string; kind: string; summary: string; appr_seq: string; engine_sig: string; created_at: string; expires_at: string }
export interface StorageLinkRow { link_id: string; engine_id: string; provider: string; enc_token: string | null; engine_sig: string; created_at: string; revoked_at: string | null }
export interface SyncResponse { changes: { storage_links?: StorageLinkRow[] | null } & Record<string, unknown>; cursor: number; next_cursor?: number | null }
export interface LoginOptions { challenge_id: string; options: RequestOptionsJSON }
export interface LoginResult { user_id: string; envelope: { envelope_id: string; wrapped_master_key: string } }
export interface RootMetaBody { list_meta: string; meta_version: number; merged_delta_ids: string[] }

export function createApi(base: string, f: Fetch = (input, init) => fetch(input, init)) {
  const get = <T>(path: string, headers?: Record<string, string>, check?: Check) => call<T>(f, base, "GET", path, undefined, headers, check);
  const send = <T>(method: "POST" | "PUT", path: string, body: unknown) => call<T>(f, base, method, path, body);
  const sendChecked = <T>(method: "POST" | "PUT", path: string, body: unknown, check: Check) => call<T>(f, base, method, path, body, {}, check);
  // Methods that take an id are async so a bad id rejects (like any other ApiFailure) instead of throwing.
  return {
    pairing: async (s: string) => get<PairingInfo>(`/v1/pairing/${id(s)}`, undefined, (d) => typeof d.delivered === "boolean"),
    registerOptions: (body: { pairing_session_id: string } | { device_add_session_id: string; join_secret: string }) =>
      send<RegisterOptions>("POST", "/v1/webauthn/register/options", body),
    registerVerify: (body: RegisterVerifyBody) => send<{ user_id: string }>("POST", "/v1/webauthn/register/verify", body),
    confirm: () => send<{ confirmed: true }>("POST", "/v1/account/confirm", {}),
    account: () => get<AccountInfo>("/v1/account", undefined, (d) => isCount(d.engine_list_version)),
    deliver: async (s: string, body: DeliverBody) => send<{ engine_id: string; engine_list_version: number }>("POST", `/v1/pairing/${id(s)}/deliver`, body),
    stepupOptions: (method: "POST" | "PUT", path: string) => send<{ challenge_id: string; options: RequestOptionsJSON }>("POST", "/v1/webauthn/stepup/options", { method, path }),
    putRecovery: (body: RecoveryBody & { assertion: StepupAssertion }) => send<{ envelope_id: string }>("PUT", "/v1/envelopes", body),
    deviceAddStart: () => send<{ session_id: string; expires_at: string }>("POST", "/v1/device-add", {}),
    deviceAddState: async (d: string) => get<DeviceAddState>(`/v1/device-add/${id(d)}`),
    deviceAddUpload: async (d: string, body: { sealed_mk: string; mac: string }) => send<{ uploaded: true }>("POST", `/v1/device-add/${id(d)}/key`, body),
    deviceAddJoin: async (d: string, body: { t_pub: string; mac: string }) => send<{ join_secret: string }>("POST", `/v1/device-add/${id(d)}/join`, body),
    deviceAddFetchKey: async (d: string, joinSecret: string) => get<{ user_id: string; sealed_mk: string; mac: string }>(`/v1/device-add/${id(d)}/key`, { "x-it-join-secret": joinSecret }),
    inbox: (body: { engine_id: string } & SealedMessage) => send<{ msg_id: string }>("POST", "/v1/inbox", body),
    approvals: () => get<{ approvals: ApprovalRow[] }>("/v1/approvals", undefined, (d) => Array.isArray(d.approvals)),
    decide: async (approvalId: string, body: { decision: "approved" | "rejected"; message: SealedMessage; assertion: StepupAssertion }) =>
      send<{ approval_id: string; status: string }>("POST", `/v1/approvals/${id(approvalId)}/decide`, body),
    sync: (cursor: number) => get<SyncResponse>(`/v1/sync?cursor=${Math.max(0, Math.floor(cursor))}`, undefined, (d) =>
      isObject(d.changes) && (d.changes.storage_links == null || Array.isArray(d.changes.storage_links))
      && isCount(d.cursor) && (d.next_cursor == null || isCount(d.next_cursor))),
    loginOptions: () => sendChecked<LoginOptions>("POST", "/v1/webauthn/login/options", {},
      (d) => typeof d.challenge_id === "string" && isObject(d.options) && typeof d.options.challenge === "string"),
    loginVerify: (body: { challenge_id: string; response: AssertionJSON }) => sendChecked<LoginResult>("POST", "/v1/webauthn/login/verify", body,
      (d) => typeof d.user_id === "string" && ID.test(d.user_id) && isObject(d.envelope)
        && typeof d.envelope.envelope_id === "string" && ID.test(d.envelope.envelope_id) && typeof d.envelope.wrapped_master_key === "string"),
    saveRootMeta: async (rootId: string, body: RootMetaBody) =>
      sendChecked<{ meta_version: number }>("POST", `/v1/roots/${id(rootId)}/meta`, body, (d) => isCount(d.meta_version)),
    logout: () => send<{ signed_out: true }>("POST", "/v1/logout", {}),
  };
}

export type Api = ReturnType<typeof createApi>;
