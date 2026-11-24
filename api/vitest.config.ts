import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
          GITHUB_APP_CLIENT_ID: "Iv23test",
          GITHUB_APP_CLIENT_SECRET: "test-secret",
        },
      },
    })),
  ],
  // The first test in a file also boots the Worker; a slow CI runner once took 5s+ (2026-11-24).
  test: { setupFiles: ["./test/apply-migrations.ts"], testTimeout: 15_000 },
});
