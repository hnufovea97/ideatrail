import { describe, expect, it } from "vitest";
import { ApiFailure, createApi, isRetryable, type Fetch } from "./api";

const SID = "01jcm3v8q7s2kx4f9d6b5n0tqw";
const reply = (status: number, body: unknown): Fetch => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("api client", () => {
  it("sends JSON with credentials and returns the parsed body", async () => {
    let seen: RequestInit | undefined;
    let url = "";
    const f: Fetch = async (u, init) => { url = String(u); seen = init; return new Response(JSON.stringify({ challenge_id: "c", user_id: "u", options: {} }), { status: 200 }); };
    const out = await createApi("http://api.test", f).registerOptions({ pairing_session_id: SID });
    expect(url).toBe("http://api.test/v1/webauthn/register/options");
    expect(seen?.credentials).toBe("include");
    expect(seen?.method).toBe("POST");
    expect((seen?.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(String(seen?.body))).toEqual({ pairing_session_id: SID });
    expect(out.challenge_id).toBe("c");
  });
  it("turns an error envelope into ApiFailure with the code only", async () => {
    const err = await createApi("http://api.test", reply(410, { error: { code: "pairing_expired", message: "Signup link expired" } })).pairing(SID).catch((e) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect(err.status).toBe(410);
    expect(err.code).toBe("pairing_expired");
    expect(String(err.message)).not.toContain("Signup link");
  });
  it("maps a strange code to 'unknown' and a network failure to 'offline'", async () => {
    const odd = await createApi("http://api.test", reply(500, { error: { code: "<script>" } })).pairing(SID).catch((e) => e);
    expect(odd.code).toBe("unknown");
    const off = await createApi("http://api.test", async () => { throw new TypeError("Failed to fetch"); }).pairing(SID).catch((e) => e);
    expect(off.code).toBe("offline");
    expect(off.status).toBe(0);
  });
  it("refuses ids that are not spec ids before any request (no path tricks)", async () => {
    let called = false;
    const api = createApi("http://api.test", async () => { called = true; return new Response("{}"); });
    const err = await api.pairing("../account").catch((e) => e);
    expect(err.code).toBe("bad_id");
    expect(called).toBe(false);
  });
  it("sends the join secret only as a header", async () => {
    let seen: RequestInit | undefined;
    const f: Fetch = async (_u, init) => { seen = init; return new Response(JSON.stringify({ user_id: "u", sealed_mk: "x", mac: "y" }), { status: 200 }); };
    await createApi("http://api.test", f).deviceAddFetchKey(SID, "s3cret");
    expect((seen?.headers as Record<string, string>)["x-it-join-secret"]).toBe("s3cret");
    expect(seen?.body).toBeUndefined();
  });
  it("rejects a 2xx answer whose JSON is not an object", async () => {
    for (const body of ["[1]", '"x"', "null", "7", ""]) {
      const api = createApi("http://api.test", async () => new Response(body, { status: 200 }));
      const err = await api.approvals().catch((e) => e);
      expect(err).toBeInstanceOf(ApiFailure);
      expect(err.code).toBe("bad_response");
    }
  });
  it("checks the fields the pages decide on", async () => {
    const ok = (body: unknown) => createApi("http://api.test", reply(200, body));
    const bad = async (p: Promise<unknown>) => expect(((await p.catch((e: unknown) => e)) as ApiFailure).code).toBe("bad_response");
    await bad(ok({ engine_id: "e" }).pairing(SID)); // delivered missing
    await bad(ok({ delivered: "no" }).pairing(SID));
    expect((await ok({ delivered: false }).pairing(SID)).delivered).toBe(false);
    await bad(ok({ engine_list: null }).account()); // engine_list_version missing
    await bad(ok({ engine_list_version: 1.5 }).account());
    expect((await ok({ engine_list_version: 0 }).account()).engine_list_version).toBe(0);
    await bad(ok({ cursor: 1, next_cursor: null }).sync(0)); // changes missing
    await bad(ok({ changes: {}, next_cursor: null }).sync(0)); // cursor missing
    await bad(ok({ changes: {}, cursor: 1, next_cursor: "2" }).sync(0));
    await bad(ok({ changes: { storage_links: {} }, cursor: 1, next_cursor: null }).sync(0));
    expect((await ok({ changes: {}, cursor: 1 }).sync(0)).cursor).toBe(1); // next_cursor absent == null
    await bad(ok({ approvals: null }).approvals());
  });
  it("only offline and 5xx are worth retrying", () => {
    expect(isRetryable(new ApiFailure(0, "offline"))).toBe(true);
    expect(isRetryable(new ApiFailure(503, "unknown"))).toBe(true);
    expect(isRetryable(new ApiFailure(404, "not_found"))).toBe(false);
    expect(isRetryable(new ApiFailure(0, "bad_id"))).toBe(false);
    expect(isRetryable(new Error("device_key_mismatch"))).toBe(false);
  });
});
