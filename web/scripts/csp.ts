// After `astro build`: compute sha256 hashes of every inline <script>/<style> in each page, put a
// CSP <meta> into the page, and write dist/_headers (same policy + frame-ancestors) for deploys.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const INLINE_STYLE = /<style[^>]*>([\s\S]*?)<\/style>/gi;
const META_CHARSET = /<meta charset="utf-8"\s*\/?>/i;

const sha = (s: string) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;
const hashesOf = (html: string, re: RegExp) => [...new Set([...html.matchAll(re)].map((m) => sha(m[1])))];

export function policyFor(html: string, apiBase: string): string {
  const api = new URL(apiBase).origin;
  const scripts = ["'self'", ...hashesOf(html, INLINE_SCRIPT)].join(" ");
  const styles = ["'self'", ...hashesOf(html, INLINE_STYLE)].join(" ");
  return [
    "default-src 'none'", `script-src ${scripts}`, `style-src ${styles}`, "img-src 'self'", "font-src 'self'",
    `connect-src 'self' ${api}`, "manifest-src 'self'", "base-uri 'none'", "form-action 'none'", "object-src 'none'",
  ].join("; ") + ";";
}

export function injectMeta(html: string, policy: string): string {
  if (!META_CHARSET.test(html)) throw new Error("no_meta_charset");
  const escaped = policy.replace(/"/g, "&quot;");
  return html.replace(META_CHARSET, (m) => `${m}<meta http-equiv="Content-Security-Policy" content="${escaped}">`);
}

function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return htmlFiles(p);
    return p.endsWith(".html") ? [p] : [];
  });
}

function main() {
  const dist = fileURLToPath(new URL("../dist/", import.meta.url));
  const apiBase = process.env.PUBLIC_API_BASE ?? "http://localhost:8787";
  const policies: string[] = [];
  for (const file of htmlFiles(dist)) {
    const html = readFileSync(file, "utf8");
    const policy = policyFor(html, apiBase);
    writeFileSync(file, injectMeta(html, policy));
    policies.push(policy);
  }
  if (policies.length === 0) throw new Error("no pages built");
  // Deploy headers apply to every path: the union of all page hashes, plus what <meta> cannot carry.
  writeFileSync(join(dist, "_headers"), [
    "/*",
    `  Content-Security-Policy: ${unionFrom(policies, apiBase)} frame-ancestors 'none';`,
    "  X-Content-Type-Options: nosniff",
    "  Referrer-Policy: no-referrer",
    "",
  ].join("\n"));
  console.log(`csp: ${policies.length} pages`);
}

/** Merge the per-page hash lists into one policy (deploy headers apply to every path). */
function unionFrom(policies: string[], apiBase: string): string {
  const pick = (dir: string) =>
    [...new Set(policies.flatMap((p) => (p.match(new RegExp(`${dir} ([^;]+);`))?.[1] ?? "").split(" ").filter((t) => t.startsWith("'sha256-"))))];
  const api = new URL(apiBase).origin;
  return [
    "default-src 'none'", `script-src 'self' ${pick("script-src").join(" ")}`.trim(), `style-src 'self' ${pick("style-src").join(" ")}`.trim(),
    "img-src 'self'", "font-src 'self'", `connect-src 'self' ${api}`, "manifest-src 'self'", "base-uri 'none'", "form-action 'none'", "object-src 'none'",
  ].join("; ") + ";";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
