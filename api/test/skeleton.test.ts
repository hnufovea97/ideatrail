import { env, exports } from "cloudflare:workers";
import { createApp } from "../src/index";
import { afterEach, describe, expect, it, vi } from "vitest";

const testApp = createApp({ testRoutes: true });
const call = (path: string, init?: RequestInit) => testApp.request(`https://api.test${path}`, init, env);

describe("skeleton (2.1)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("unknown route → 404 JSON error", async () => {
    const r = await call("/v1/nope");
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: { code: "not_found", message: expect.any(String) } });
  });

  it("65KB body → 413 before the handler runs", async () => {
    const r = await call("/v1/__test/echo", { method: "POST", body: "x".repeat(65 * 1024), headers: { "content-type": "application/json" } });
    expect(r.status).toBe(413);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("payload_too_large");
  });

  it("64KB body is accepted", async () => {
    const r = await call("/v1/__test/echo", { method: "POST", body: "x".repeat(64 * 1024) });
    expect(r.status).toBe(200);
  });

  it("logs never contain body, signature header, cookie, query or path ids", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(" ")); });
    await call("/v1/__test/echo?token=SECRET_QUERY", {
      method: "POST",
      body: '{"secret":"SECRET_BODY"}',
      headers: { "content-type": "application/json", "x-it-sig": "SECRET_SIG", cookie: "__Host-it_s=SECRET_COOKIE" },
    });
    const all = lines.join("\n");
    expect(all).toContain("/v1/__test/echo");
    for (const s of ["SECRET_BODY", "SECRET_SIG", "SECRET_COOKIE", "SECRET_QUERY"]) expect(all).not.toContain(s);
  });

  it("CORS allows only APP_ORIGIN, with credentials", async () => {
    const pre = (origin: string) => call("/v1/account", { method: "OPTIONS", headers: { origin, "access-control-request-method": "GET" } });
    const ok = await pre("http://localhost:4321");
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:4321");
    expect(ok.headers.get("access-control-allow-credentials")).toBe("true");
    expect((await pre("https://evil.example")).headers.get("access-control-allow-origin")).toBeNull();
  });

  it("internal errors return a generic 500 without details", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const r = await call("/v1/__test/throw");
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("boom-detail");
  });

  it("the deployed entry has no test routes", async () => {
    expect((await exports.default.fetch(new Request("https://api.test/v1/__test/throw"))).status).toBe(404);
  });

  it("security headers are set", async () => {
    const r = await call("/v1/nope");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});
