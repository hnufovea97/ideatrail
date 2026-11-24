// Line comparison of two versions of one text file (5.6): LCS over the lines left after the shared head and tail.
export type DiffOp = "same" | "add" | "del";
export interface DiffLine { op: DiffOp; text: string }

/** Past this many differing lines on either side the table would be too big for a phone: the screen says "too long". */
export const MAX_DIFF_LINES = 1500;

function linesOf(s: string): string[] {
  const parts = s.split(/\r?\n/);
  if (parts[parts.length - 1] === "") parts.pop(); // a final newline is not an extra empty line
  return parts;
}

/** null = too long to compare. Otherwise every line of both texts appears once, in reading order. */
export function lineDiff(before: string, after: string): DiffLine[] | null {
  const a = linesOf(before);
  const b = linesOf(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  if (x.length > MAX_DIFF_LINES || y.length > MAX_DIFF_LINES) return null;

  const w = y.length + 1;
  const len = new Uint16Array((x.length + 1) * w); // len[i*w+j] = LCS of x[i..] and y[j..]
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      len[i * w + j] = x[i] === y[j] ? len[(i + 1) * w + j + 1] + 1 : Math.max(len[(i + 1) * w + j], len[i * w + j + 1]);
    }
  }
  const out: DiffLine[] = a.slice(0, head).map((text) => ({ op: "same", text }));
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { out.push({ op: "same", text: x[i] }); i++; j++; }
    else if (j >= y.length || (i < x.length && len[(i + 1) * w + j] >= len[i * w + j + 1])) out.push({ op: "del", text: x[i++] });
    else out.push({ op: "add", text: y[j++] });
  }
  return [...out, ...a.slice(a.length - tail).map((text): DiffLine => ({ op: "same", text }))];
}
