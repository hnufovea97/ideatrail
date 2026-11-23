import type { Api } from "../api";
import { parsePage } from "./rows";
import { applyPage, type SyncState } from "./store";

export const MAX_PAGES = 50; // per refresh; the rest comes on the next one (state stays incomplete)

/** Pull every page after `s.cursor`. Only a pull that reached next_cursor = null is complete. */
export async function pull(api: Api, s: SyncState): Promise<SyncState> {
  let cur: SyncState = { ...s, complete: false };
  for (let i = 0; i < MAX_PAGES; i++) {
    const r = await api.sync(cur.cursor);
    const done = r.next_cursor == null;
    cur = applyPage(cur, parsePage(r.changes), r.cursor, done);
    if (done) return cur;
  }
  return cur;
}
