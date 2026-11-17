import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/index";

const preflight = (headers: string) =>
  createApp().request("https://api.test/v1/device-add/01jcm3v8q7s2kx4f9d6b5n0tqw/key", {
    method: "OPTIONS",
    headers: { origin: env.APP_ORIGIN, "access-control-request-method": "GET", "access-control-request-headers": headers },
  }, env);

describe("CORS for the app origin", () => {
  it("allows the device-add join secret header (phone fetches its sealed key with it)", async () => {
    const res = await preflight("x-it-join-secret");
    expect(res.headers.get("access-control-allow-origin")).toBe(env.APP_ORIGIN);
    expect((res.headers.get("access-control-allow-headers") ?? "").toLowerCase()).toContain("x-it-join-secret");
  });
  it("still refuses other origins", async () => {
    const res = await createApp().request("https://api.test/v1/account", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "GET" } }, env);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
