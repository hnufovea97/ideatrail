// The dashboard's only GitHub write: the index/ mirror (spec §12, §3.1.10 E) as one commit through the Git Data API,
// with the engine's GitHub access opened from kind 6. The token goes only in the Authorization header and never
// into an error. Only to the pinned repo id, and only when it is private.
import type { Fetch } from "../api";

export const GITHUB_API = "https://api.github.com";
export const COMMIT_ATTEMPTS = 5; // same as the engine (spec §12)
export const INDEX_MESSAGE = "ideatrail: index"; // no content information (spec §12)

export interface RepoAccess { token: string; fullName: string; repoId: number }

export class GithubFailure extends Error {
  constructor(readonly status: number, readonly code: "offline" | "github_refused" | "bad_response" | "repo_mismatch" | "bad_repo") {
    super(code);
    this.name = "GithubFailure";
  }
}

const FULL_NAME = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const BRANCH = /^[A-Za-z0-9._-]{1,100}$/;
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function toBase64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

async function gh<T>(f: Fetch, a: RepoAccess, signal: AbortSignal | undefined, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await f(GITHUB_API + path, {
      method, signal, credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${a.token}`, "x-github-api-version": "2022-11-28", ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new GithubFailure(0, "offline");
  }
  if (!res.ok) throw new GithubFailure(res.status, "github_refused");
  try {
    return (await res.json()) as T;
  } catch {
    throw new GithubFailure(res.status, "bad_response");
  }
}

function shaOf(v: unknown): string {
  const s = (v as { sha?: unknown } | null | undefined)?.sha;
  if (typeof s !== "string" || !SHA.test(s)) throw new GithubFailure(0, "bad_response");
  return s;
}

/** Write `files` (path → bytes) in one commit on the default branch; retries a moved ref. Returns the commit sha.
 * `signal` is the lock's: aborting it stops an in-flight commit. */
export async function commitIndex(f: Fetch, a: RepoAccess, files: Readonly<Record<string, Uint8Array>>, signal?: AbortSignal): Promise<string> {
  if (!FULL_NAME.test(a.fullName)) throw new GithubFailure(0, "bad_repo");
  const repo = await gh<{ id?: unknown; private?: unknown; default_branch?: unknown }>(f, a, signal, "GET", `/repos/${a.fullName}`);
  if (repo.id !== a.repoId || repo.private !== true || typeof repo.default_branch !== "string" || !BRANCH.test(repo.default_branch)) {
    throw new GithubFailure(0, "repo_mismatch");
  }
  const git = `/repos/${a.fullName}/git`;
  const branch = repo.default_branch;
  const tree = await Promise.all(Object.entries(files).map(async ([path, bytes]) =>
    ({ path, mode: "100644", type: "blob", sha: shaOf(await gh(f, a, signal, "POST", `${git}/blobs`, { content: toBase64(bytes), encoding: "base64" })) })));
  for (let attempt = 1; ; attempt++) {
    const head = shaOf((await gh<{ object?: unknown }>(f, a, signal, "GET", `${git}/ref/heads/${branch}`)).object);
    const baseTree = shaOf((await gh<{ tree?: unknown }>(f, a, signal, "GET", `${git}/commits/${head}`)).tree);
    const newTree = shaOf(await gh(f, a, signal, "POST", `${git}/trees`, { base_tree: baseTree, tree }));
    const commit = shaOf(await gh(f, a, signal, "POST", `${git}/commits`, { message: INDEX_MESSAGE, tree: newTree, parents: [head] }));
    try {
      await gh(f, a, signal, "PATCH", `${git}/refs/heads/${branch}`, { sha: commit, force: false });
      return commit;
    } catch (e) {
      const moved = e instanceof GithubFailure && (e.status === 409 || e.status === 422);
      if (!moved || attempt >= COMMIT_ATTEMPTS) throw e;
    }
  }
}

/** Biggest answer a proofs/ file read accepts: a sealed original is at most 25 MB (engine MaxOriginalTotal) plus its tar and seal overhead. */
export const MAX_READ_BYTES = 30 << 20;
const REPO_PATH = /^[A-Za-z0-9._/-]{1,200}$/;

/** Read one file of the repo as raw bytes (the dashboard's only GitHub read). null = the file is not there (404).
 * The token goes only in the Authorization header; an over-size answer is cut off and refused. */
export async function readRepoFile(f: Fetch, a: RepoAccess, path: string, signal?: AbortSignal): Promise<Uint8Array | null> {
  if (!FULL_NAME.test(a.fullName) || !REPO_PATH.test(path) || path.split("/").some((s) => s === "" || s === "." || s === "..")) throw new GithubFailure(0, "bad_repo");
  let res: Response;
  try {
    res = await f(`${GITHUB_API}/repos/${a.fullName}/contents/${path}`, {
      method: "GET", signal, credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
      headers: { accept: "application/vnd.github.raw+json", authorization: `Bearer ${a.token}`, "x-github-api-version": "2022-11-28" },
    });
  } catch {
    throw new GithubFailure(0, "offline");
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new GithubFailure(res.status, "github_refused");
  if (Number(res.headers.get("content-length") ?? 0) > MAX_READ_BYTES) throw new GithubFailure(res.status, "bad_response");
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_READ_BYTES) {
        void reader.cancel();
        throw new Error("too big");
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  } catch {
    throw new GithubFailure(res.status, "bad_response");
  }
}
