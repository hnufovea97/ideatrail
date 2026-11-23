import { describe, expect, it } from "vitest";
import { ApiFailure, createApi, type AssertionJSON, type Fetch } from "./api";

const UID = "01jcm3v8q7s2kx4f9d6b5n0tqw";
const RID = "01jcm3v8q7s2kx4f9d6b5n0tqx";

function capture(body: unknown, status = 200) {
  const seen: { url: string; init?: RequestInit }[] = [];
  const f: Fetch = async (u, init) => {
    seen.push({ url: String(u), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { seen, api: createApi("http://api.test", f) };
}

describe("api client — dashboard routes", () => {
  it("login options: POST with an empty JSON body", async () => {
    const { seen, api } = capture({ challenge_id: UID, options: { challenge: "AAAA", rpId: "localhost" } });
    const out = await api.loginOptions();
    expect(seen[0].url).toBe("http://api.test/v1/webauthn/login/options");
    expect(seen[0].init?.method).toBe("POST");
    expect(JSON.parse(String(seen[0].init?.body))).toEqual({});
    expect(out.options.challenge).toBe("AAAA");
  });
  it("login options without a challenge is a bad response", async () => {
    const err = await capture({ challenge_id: UID, options: {} }).api.loginOptions().catch((e) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect(err.code).toBe("bad_response");
  });
  it("login verify sends the assertion and needs a user id and an envelope back", async () => {
    const { seen, api } = capture({ user_id: UID, envelope: { envelope_id: RID, wrapped_master_key: "SVQxgA" } });
    const response = { id: "x", rawId: "x", type: "public-key", clientExtensionResults: {}, response: { clientDataJSON: "a", authenticatorData: "b", signature: "c" } } as AssertionJSON;
    const out = await api.loginVerify({ challenge_id: UID, response });
    expect(seen[0].url).toBe("http://api.test/v1/webauthn/login/verify");
    expect(JSON.parse(String(seen[0].init?.body))).toEqual({ challenge_id: UID, response });
    expect(out.envelope.envelope_id).toBe(RID);
    const bad = await capture({ user_id: "../x", envelope: {} }).api.loginVerify({ challenge_id: UID, response }).catch((e) => e);
    expect(bad.code).toBe("bad_response");
  });
  it("saves merged root meta with the previous version; a conflict keeps its code", async () => {
    const { seen, api } = capture({ meta_version: 4 });
    const body = { list_meta: "SVQxgg", meta_version: 3, merged_delta_ids: [UID] };
    expect(await api.saveRootMeta(RID, body)).toEqual({ meta_version: 4 });
    expect(seen[0].url).toBe(`http://api.test/v1/roots/${RID}/meta`);
    expect(JSON.parse(String(seen[0].init?.body))).toEqual(body);
    const err = await capture({ error: { code: "meta_version_conflict" } }, 409).api.saveRootMeta(RID, body).catch((e) => e);
    expect(err.status).toBe(409);
    expect(err.code).toBe("meta_version_conflict");
  });
  it("refuses a root id that is not a spec id before any request", async () => {
    const { seen, api } = capture({});
    const err = await api.saveRootMeta("../account", { list_meta: "x", meta_version: 0, merged_delta_ids: [] }).catch((e) => e);
    expect(err.code).toBe("bad_id");
    expect(seen).toEqual([]);
  });
  it("logout posts to /v1/logout", async () => {
    const { seen, api } = capture({ signed_out: true });
    await api.logout();
    expect(seen[0].url).toBe("http://api.test/v1/logout");
    expect(seen[0].init?.method).toBe("POST");
  });
});
