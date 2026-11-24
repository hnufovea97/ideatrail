// After `astro build`: compute sha256 hashes of every inline <script>/<style> in each page, put a
// CSP <meta> into the page, and write dist/_headers (same policy + frame-ancestors, framing/opener/
// passkey permissions, no-store for the signup pages) for deploys.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const INLINE_STYLE = /<style[^>]*>([\s\S]*?)<\/style>/gi;
const META_CHARSET = /<meta charset="utf-8"\s*\/?>/i;

/** index/ mirror (M5a) and originals (M5b); data only, never scripts. csp.test ties it to src/lib/mirror/github.ts. */
export const GITHUB_API = "https://api.github.com";
/** The two block explorers the browser asks itself before it says 확정 (5.7, plan D1); csp.test ties them to src/lib/proof/explorers.ts. */
export const EXPLORER_ORIGINS = ["https://blockstream.info", "https://mempool.space"] as const;
/** Only the page that holds the open keys talks to GitHub (sec L5) and to the explorers. */
const GITHUB_PAGES = ["/home", "/home/"];
const HOME_CONNECT = [GITHUB_API, ...EXPLORER_ORIGINS];

export const connectExtraFor = (route: string): string[] => (GITHUB_PAGES.includes(route) ? HOME_CONNECT : []);

const sha = (s: string) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;
const hashesOf = (html: string, re: RegExp) => [...new Set([...html.matchAll(re)].map((m) => sha(m[1])))];

function policy(scriptHashes: readonly string[], styleHashes: readonly string[], connect: readonly string[]): string {
  return [
    "default-src 'none'", ["script-src 'self'", ...scriptHashes].join(" "), ["style-src 'self'", ...styleHashes].join(" "), "img-src 'self'", "font-src 'self'",
    ["connect-src 'self'", ...connect].join(" "), "manifest-src 'self'", "base-uri 'none'", "form-action 'none'", "object-src 'none'",
  ].join("; ") + ";";
}

export function policyFor(html: string, apiBase: string, connectExtra: readonly string[] = []): string {
  return policy(hashesOf(html, INLINE_SCRIPT), hashesOf(html, INLINE_STYLE), [new URL(apiBase).origin, ...connectExtra]);
}

export function injectMeta(html: string, policy: string): string {
  if (!META_CHARSET.test(html)) throw new Error("no_meta_charset");
  const escaped = policy.replace(/"/g, "&quot;");
  return html.replace(META_CHARSET, (m) => `${m}<meta http-equiv="Content-Security-Policy" content="${escaped}">`);
}

/** Pages that hold secrets in memory: never stored by a cache (both URL forms Pages may serve). */
const NO_STORE = ["/start", "/start/", "/connect", "/connect/", "/home", "/home/"];

/**
 * Cloudflare Pages `_headers`: what <meta> cannot carry, for every path, plus no-store for the signup pages.
 * `homeCsp` (with GitHub) replaces the shared policy on /home: `! Content-Security-Policy` detaches the one from `/*`
 * (two CSP headers would both apply, so GitHub would stay blocked).
 */
export function headersFile(csp: string, homeCsp?: string): string {
  const all = [
    "/*",
    `  Content-Security-Policy: ${csp} frame-ancestors 'none';`,
    "  X-Frame-Options: DENY",
    "  Cross-Origin-Opener-Policy: same-origin",
    "  Permissions-Policy: publickey-credentials-create=(self), publickey-credentials-get=(self)",
    "  X-Content-Type-Options: nosniff",
    "  Referrer-Policy: no-referrer",
  ].join("\n");
  const own = (p: string) => (homeCsp && GITHUB_PAGES.includes(p) ? [`  ! Content-Security-Policy`, `  Content-Security-Policy: ${homeCsp} frame-ancestors 'none';`] : []);
  return [all, ...NO_STORE.map((p) => [p, ...own(p), "  Cache-Control: no-store"].join("\n"))].join("\n\n") + "\n";
}

function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return htmlFiles(p);
    return p.endsWith(".html") ? [p] : [];
  });
}

/** dist/home/index.html → "/home" (Astro's directory output). */
const routeOf = (dist: string, file: string) => "/" + relative(dist, file).split(sep).join("/").replace(/(^|\/)index\.html$/, "").replace(/\.html$/, "");

function main() {
  const dist = fileURLToPath(new URL("../dist/", import.meta.url));
  const apiBase = process.env.PUBLIC_API_BASE ?? "http://localhost:8787";
  const policies: string[] = [];
  for (const file of htmlFiles(dist)) {
    const html = readFileSync(file, "utf8");
    const p = policyFor(html, apiBase, connectExtraFor(routeOf(dist, file)));
    writeFileSync(file, injectMeta(html, p));
    policies.push(p);
  }
  if (policies.length === 0) throw new Error("no pages built");
  // Deploy headers apply to every path: the union of all page hashes, plus what <meta> cannot carry; /home adds GitHub.
  writeFileSync(join(dist, "_headers"), headersFile(unionFrom(policies, apiBase), unionFrom(policies, apiBase, HOME_CONNECT)));
  console.log(`csp: ${policies.length} pages`);
}

/** Merge the per-page hash lists into one policy (deploy headers apply to every path). */
function unionFrom(policies: string[], apiBase: string, connectExtra: readonly string[] = []): string {
  const pick = (dir: string) =>
    [...new Set(policies.flatMap((p) => (p.match(new RegExp(`${dir} ([^;]+);`))?.[1] ?? "").split(" ").filter((t) => t.startsWith("'sha256-"))))];
  return policy(pick("script-src"), pick("style-src"), [new URL(apiBase).origin, ...connectExtra]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
