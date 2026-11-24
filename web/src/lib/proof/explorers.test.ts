import { describe, expect, it } from "vitest";
import { BLOCKSTREAM, MEMPOOL, httpExplorer } from "./explorers";

const HASH = "0a".repeat(32), ROOT = "0b".repeat(32);
type Call = { url: string; init: RequestInit | undefined };

function server(answers: Record<string, () => Response>) {
  const calls: Call[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const make = answers[new URL(String(input)).pathname.replace(/^\/api/, "")];
    return make ? make() : new Response("", { status: 404 });
  };
  return { fetcher, calls };
}
const ok = () => ({
  [`/block-height/870000`]: () => new Response(`${HASH}\n`),
  [`/block/${HASH}`]: () => new Response(JSON.stringify({ id: HASH, merkle_root: ROOT, timestamp: 1_764_000_000, extra: "x" })),
});

describe("httpExplorer", () => {
  it("fetches the block hash, then the block, and returns only the three checked fields", async () => {
    const s = server(ok());
    const e = httpExplorer(BLOCKSTREAM, s.fetcher);
    expect(await e.blockAt(870_000)).toEqual({ hash: HASH, merkleRoot: ROOT, time: 1_764_000_000 });
    expect(s.calls.map((c) => c.url)).toEqual([`${BLOCKSTREAM}/block-height/870000`, `${BLOCKSTREAM}/block/${HASH}`]);
  });
  it("sends no credentials, no referrer, no body and nothing about the user", async () => {
    const s = server(ok());
    await httpExplorer(MEMPOOL, s.fetcher).blockAt(870_000);
    for (const c of s.calls) {
      expect(c.init).toMatchObject({ method: "GET", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
      expect(c.init?.body).toBeUndefined();
      expect(Object.keys(c.init?.headers ?? {})).toEqual([]);
    }
  });
  it("rejects a bad height, a non-hash answer, a bad merkle root, an error status and an oversized answer", async () => {
    const run = (answers: Record<string, () => Response>, h = 870_000) => httpExplorer(BLOCKSTREAM, server(answers).fetcher).blockAt(h);
    await expect(run(ok(), -1)).rejects.toThrow();
    await expect(run(ok(), 1.5)).rejects.toThrow();
    await expect(run({ "/block-height/870000": () => new Response("<html>nope") })).rejects.toThrow();
    await expect(run({ ...ok(), [`/block/${HASH}`]: () => new Response(JSON.stringify({ merkle_root: "zz", timestamp: 1 })) })).rejects.toThrow();
    await expect(run({ "/block-height/870000": () => new Response("x", { status: 500 }) })).rejects.toThrow();
    await expect(run({ ...ok(), [`/block/${HASH}`]: () => new Response("x".repeat(100_000)) })).rejects.toThrow();
  });
});
