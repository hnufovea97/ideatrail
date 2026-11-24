import { describe, expect, it } from "vitest";
import { readCapped } from "./read-capped";

const chunked = (parts: string[]) => new Response(new ReadableStream({
  start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); },
}));

describe("readCapped", () => {
  it("reads a chunked body under the cap", async () => {
    expect(new TextDecoder().decode(await readCapped(chunked(["ab", "cd"]), 4))).toBe("abcd");
  });
  it("stops a chunked body with no length header once it passes the cap", async () => {
    await expect(readCapped(chunked(["abc", "de"]), 4)).rejects.toThrow("too big");
  });
  it("refuses a declared length over the cap", async () => {
    await expect(readCapped(new Response("x", { headers: { "content-length": "99" } }), 4)).rejects.toThrow("too big");
  });
});
