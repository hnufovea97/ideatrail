/// <reference types="astro/client" />
interface ImportMetaEnv {
  readonly PUBLIC_API_BASE?: string;
  readonly PUBLIC_TEST_HOOKS?: string; // "1" only in E2E builds (playwright.config.ts)
}
