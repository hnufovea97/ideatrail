// The two public block explorers the browser asks itself (ADR-0013, plan D1). Nothing about the user is sent: a plain
// GET of a block height, no body, no cookies, no referrer, no headers. What comes back is checked field by field and
// capped in size; anything else is a failure (the caller reads a failure as "not checked yet", never as confirmed).
import type { Fetch } from "../api";

export const BLOCKSTREAM = "https://blockstream.info/api"; // explorer A
export const MEMPOOL = "https://mempool.space/api"; // explorer B
export const EXPLORER_ORIGINS = ["https://blockstream.info", "https://mempool.space"] as const; // the /home CSP lists the same two (scripts/csp.ts)

export interface BlockInfo { hash: string; merkleRoot: string; time: number }
/** blockAt throws when the explorer cannot answer properly. */
export interface Explorer { blockAt(height: number, signal?: AbortSignal): Promise<BlockInfo> }

const HEX64 = /^[0-9a-f]{64}$/;
const MAX_HEIGHT = 10_000_000;
const MAX_ANSWER = 16 * 1024; // a block header answer is ~1 KB
const TIMEOUT_MS = 10_000;

export class ExplorerFailure extends Error {}
const fail = (why: string) => new ExplorerFailure(`explorer: ${why}`);

async function textOf(res: Response): Promise<string> {
  if (!res.ok) throw fail(`status ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_ANSWER) throw fail("too large");
  const text = await res.text();
  if (text.length > MAX_ANSWER) throw fail("too large");
  return text;
}

export function httpExplorer(base: string, f: Fetch): Explorer {
  const get = async (path: string, signal?: AbortSignal) => {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    return textOf(await f(base + path, {
      method: "GET", credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    }));
  };
  return {
    async blockAt(height, signal) {
      if (!Number.isSafeInteger(height) || height < 0 || height > MAX_HEIGHT) throw fail("bad height");
      const hash = (await get(`/block-height/${height}`, signal)).trim();
      if (!HEX64.test(hash)) throw fail("bad hash");
      let block: { merkle_root?: unknown; timestamp?: unknown } | null;
      try {
        block = JSON.parse(await get(`/block/${hash}`, signal));
      } catch (e) {
        throw e instanceof ExplorerFailure ? e : fail("bad block");
      }
      const root = block?.merkle_root, time = block?.timestamp;
      if (typeof root !== "string" || !HEX64.test(root) || !Number.isSafeInteger(time) || (time as number) <= 0) throw fail("bad block");
      return { hash, merkleRoot: root, time: time as number };
    },
  };
}

/** The pair used by the app. `f` is the page's fetch (credentials and referrer are set per request above). */
export const browserExplorers = (f: Fetch) => ({ a: httpExplorer(BLOCKSTREAM, f), b: httpExplorer(MEMPOOL, f) });
