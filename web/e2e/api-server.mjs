// Starts the real API locally for E2E: fresh local D1 under web/.e2e (never the developer's own
// wrangler state, never staging), migrations applied, `wrangler dev --env e2e` on :8787.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const apiDir = fileURLToPath(new URL("../../api/", import.meta.url));
const state = fileURLToPath(new URL("../.e2e/wrangler/", import.meta.url));
rmSync(state, { recursive: true, force: true });
mkdirSync(state, { recursive: true });
const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };

const migrate = spawnSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "ideatrail", "--local", "--env", "e2e", "--persist-to", state],
  { cwd: apiDir, stdio: "inherit", env });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const dev = spawn("pnpm", ["exec", "wrangler", "dev", "--env", "e2e", "--port", "8787", "--ip", "localhost", "--persist-to", state, "--show-interactive-dev-session=false"],
  { cwd: apiDir, stdio: "inherit", env });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => dev.kill(sig));
dev.on("exit", (code) => process.exit(code ?? 0));
