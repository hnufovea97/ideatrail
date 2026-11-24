// The browser's confirmation results for one unlocked session: in memory only (never localStorage), forgotten at lock.
// Only a decided answer (confirmed / mismatch / invalid) is kept; "checking" is asked again next time. A block answer is
// kept per explorer and height so many versions in one block cost one request each.
import type { IdeaView, VersionView } from "../model/read-model";
import { fromHex } from "../commit";
import { confirmAnchor, type Confirmation, type Explorers } from "./confirm";
import type { BlockInfo, Explorer } from "./explorers";

function memoized(e: Explorer): Explorer {
  const known = new Map<number, Promise<BlockInfo>>();
  return {
    blockAt(height, signal) {
      let p = known.get(height);
      if (!p) {
        p = e.blockAt(height, signal);
        known.set(height, p);
        p.catch(() => known.delete(height)); // a failure is asked again later
      }
      return p;
    },
  };
}

const wanted = (v: VersionView) => v.server.anchor === "server_confirmed" && v.server.receipt !== null;

export class ConfirmSession {
  private readonly decided = new Map<string, { receipt: string; result: Confirmation }>();
  private readonly ex: Explorers;
  constructor(explorers: Explorers) {
    this.ex = { a: memoized(explorers.a), b: memoized(explorers.b) };
  }

  get results(): ReadonlyMap<string, Confirmation> {
    return new Map([...this.decided].map(([id, d]) => [id, d.result]));
  }

  /** Check every server-confirmed version not decided yet. True when a new answer came in (so the screen should redraw). */
  async check(ideas: readonly IdeaView[], signal?: AbortSignal): Promise<boolean> {
    const todo = ideas.flatMap((i) => i.versions).filter((v) => wanted(v) && this.decided.get(v.recordId)?.receipt !== v.server.receipt);
    let changed = false;
    for (const v of todo) {
      if (signal?.aborted) break;
      const receipt = v.server.receipt as string;
      const result = await confirmAnchor(fromHex(v.server.commitment), receipt, this.ex, signal);
      if (signal?.aborted || result.state === "checking") continue;
      this.decided.set(v.recordId, { receipt, result });
      changed = true;
    }
    return changed;
  }

  clear(): void {
    this.decided.clear();
  }
}
