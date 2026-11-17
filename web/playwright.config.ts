import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:4321", locale: "ko-KR", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    { command: "node e2e/api-server.mjs", port: 8787, reuseExistingServer: false, timeout: 180_000 },
    // `--ignore-lock` keeps `astro preview` in the foreground (Astro 7 backgrounds itself when it detects an AI agent).
    { command: "pnpm build && pnpm preview --ignore-lock", port: 4321, reuseExistingServer: false, timeout: 180_000, env: { PUBLIC_API_BASE: "http://localhost:8787" } },
  ],
});
