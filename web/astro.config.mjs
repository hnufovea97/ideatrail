import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";

// Static output only (ADR-0007). No inlined assets or styles, so CSP hashes stay few and stable.
export default defineConfig({
  output: "static",
  integrations: [preact()],
  server: { port: 4321, host: "localhost" },
  build: { inlineStylesheets: "never" },
  devToolbar: { enabled: false },
  prefetch: false,
  vite: { build: { assetsInlineLimit: 0 } },
});
