/** Read a response body as a stream and stop once it passes `max` bytes (a chunked answer has no length header).
 * Throws on a missing body or one that is too large. */
export async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  if (Number(res.headers.get("content-length") ?? 0) > max) throw new Error("too big");
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      void reader.cancel();
      throw new Error("too big");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
