import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import indexMd from "../../docs/api-index.md?raw";
import { createApp } from "../src/index";
import { fakeLimiter } from "./browser";

const METHODS = new Set(["GET", "POST", "PUT", "DELETE"]);

/** (METHOD path) pairs from the api-index table; "POST/GET" and "a · b" cells are expanded. */
export function indexRoutes(md: string): Set<string> {
  const out = new Set<string>();
  for (const line of md.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 4 || !/^[A-Z/]+$/.test(cells[1])) continue;
    const methods = cells[1].split("/").filter((m) => METHODS.has(m));
    const paths = [...cells[2].matchAll(/`([^`]+)`/g)].map((m) => m[1].split("?")[0]).filter((p) => p.startsWith("/v1/"));
    for (const m of methods) for (const p of paths) out.add(`${m} ${p}`);
  }
  return out;
}

function appRoutes(): Set<string> {
  const app = createApp({ limiter: () => fakeLimiter(1e6) });
  return new Set(
    app.routes
      .filter((r) => METHODS.has(r.method) && r.path.startsWith("/v1/") && !r.path.startsWith("/v1/__test"))
      .map((r) => `${r.method} ${r.path.replace(/\/$/, "") || "/"}`),
  );
}

describe("api-index ↔ routes (QA S4)", () => {
  it("every implemented route is documented", () => {
    const documented = indexRoutes(indexMd);
    const missing = [...appRoutes()].filter((r) => !documented.has(r));
    expect(missing).toEqual([]);
  });

  it("lists documented routes not built yet (M2b)", () => {
    const built = appRoutes();
    const pending = [...indexRoutes(indexMd)].filter((r) => !built.has(r)).sort();
    console.info(`api-index: ${built.size} built, ${pending.length} pending:\n  ${pending.join("\n  ")}`);
    expect(pending.length).toBeGreaterThanOrEqual(0);
  });
});

/** Routes that are public by design (still validated and/or rate-limited). */
const PUBLIC = new Set([
  "POST /v1/pairing", "GET /v1/pairing/:id",
  "POST /v1/webauthn/register/options", "POST /v1/webauthn/register/verify",
  "POST /v1/webauthn/login/options", "POST /v1/webauthn/login/verify",
  "POST /v1/recovery/envelope", "POST /v1/device-add/:id/join", "GET /v1/device-add/:id/key",
  "POST /v1/logout", // clears any cookie, even an expired one
]);

describe("route × auth matrix", () => {
  const sample = (p: string) => p.replace(/:id/g, "0".repeat(26));

  it("every non-public route refuses a request without credentials", async () => {
    const app = createApp({ limiter: () => fakeLimiter(1e6) });
    const results: string[] = [];
    for (const r of appRoutes()) {
      if (PUBLIC.has(r)) continue;
      const [method, path] = r.split(" ");
      const res = await app.request(`https://api.test${sample(path)}`, {
        method, headers: { origin: "http://localhost:4321", "content-type": "application/json" }, body: method === "GET" ? undefined : "{}",
      }, env);
      if (![401, 403].includes(res.status)) results.push(`${r} → ${res.status}`);
    }
    expect(results).toEqual([]);
  });

  it("public routes never succeed on an empty request", async () => {
    const app = createApp({ limiter: () => fakeLimiter(1e6) });
    for (const r of PUBLIC) {
      const [method, path] = r.split(" ");
      if (r === "POST /v1/webauthn/login/options" || r === "POST /v1/logout") continue; // succeed by design
      const res = await app.request(`https://api.test${sample(path)}`, {
        method, headers: { origin: "http://localhost:4321", "content-type": "application/json" }, body: method === "GET" ? undefined : "{}",
      }, env);
      expect(res.status, r).toBeGreaterThanOrEqual(400);
    }
  });
});
