// Results that are costly to recompute (signature checks, opened metas), kept across refreshes of one open vault and
// dropped on lock. Keyed by (kind, id, change_seq); a hit also needs the very same row object, so a server that reuses
// a change_seq with other bytes is checked again instead of riding on an earlier verdict.
interface Entry { row: object; value: unknown }

export class RowCache {
  private readonly m = new Map<string, Entry>();
  hits = 0;

  get size(): number {
    return this.m.size;
  }

  private key(kind: string, id: string, row: { change_seq: number }) {
    return `${kind}\t${id}\t${row.change_seq}`;
  }

  /** The cached value for this exact row, or `undefined`. */
  get<T>(kind: string, id: string, row: { change_seq: number }): T | undefined {
    const e = this.m.get(this.key(kind, id, row));
    if (!e || e.row !== row) return undefined;
    this.hits++;
    return e.value as T;
  }

  set(kind: string, id: string, row: { change_seq: number }, value: unknown): void {
    this.m.set(this.key(kind, id, row), { row, value });
  }

  /** On lock: drop every reference (decrypted metas included). */
  clear(): void {
    this.m.clear();
    this.hits = 0;
  }
}

/** Compute once per row version. */
export function cached<T>(cache: RowCache | undefined, kind: string, id: string, row: { change_seq: number }, compute: () => T): T {
  const hit = cache?.get<T>(kind, id, row);
  if (hit !== undefined) return hit;
  const value = compute();
  cache?.set(kind, id, row, value);
  return value;
}
