import { toB64u } from "@ideatrail/crypto/bytes";
import { serializeTimestamp, type Timestamp } from "@ideatrail/crypto/ots";
import { describe, expect, it } from "vitest";
import { idea, version } from "../home/fixtures";
import type { VersionView } from "../model/read-model";
import type { BlockInfo, Explorer } from "./explorers";
import { ConfirmSession } from "./session";

const tree = (commitment: Uint8Array): Timestamp => ({ msg: commitment, attestations: [{ kind: "bitcoin", height: 870_000 }], ops: [] });
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/** A server-confirmed version whose receipt is just "the fingerprint itself is the merkle root". */
function confirmedVersion(fill: number): { v: VersionView; block: BlockInfo } {
  const commitment = new Uint8Array(32).fill(fill);
  const v = version({ anchor: "server_confirmed" });
  const server = { ...v.server, commitment: hex(commitment), receipt: toB64u(serializeTimestamp(tree(commitment))) };
  return { v: { ...v, server }, block: { hash: "ab".repeat(32), merkleRoot: hex(commitment.slice().reverse()), time: 1_764_000_000 } };
}

function explorer(blocks: BlockInfo[], log: number[], down = () => false): Explorer {
  return { blockAt: async (h) => { log.push(h); if (down()) throw new Error("offline"); return blocks[0]; } };
}

describe("ConfirmSession", () => {
  it("confirms server-confirmed versions with both explorers and remembers the answer for the session", async () => {
    const { v, block } = confirmedVersion(5);
    const log: number[] = [];
    const s = new ConfirmSession({ a: explorer([block], log), b: explorer([block], log) });
    expect(await s.check([idea({ versions: [v] })])).toBe(true);
    expect(s.results.get(v.recordId)?.state).toBe("confirmed");
    const asked = log.length;
    expect(await s.check([idea({ versions: [v] })])).toBe(false); // nothing new: no further requests
    expect(log.length).toBe(asked);
  });
  it("never asks about a version the server has not confirmed", async () => {
    const log: number[] = [];
    const e = explorer([], log);
    const s = new ConfirmSession({ a: e, b: e });
    await s.check([idea({ versions: [version({ anchor: "pending" })] })]);
    expect(log).toEqual([]);
    expect(s.results.size).toBe(0);
  });
  it("a down explorer keeps 'checking' and is asked again on the next check", async () => {
    const { v, block } = confirmedVersion(6);
    let down = true;
    const log: number[] = [];
    const s = new ConfirmSession({ a: explorer([block], log, () => down), b: explorer([block], log) });
    await s.check([idea({ versions: [v] })]);
    expect(s.results.has(v.recordId)).toBe(false);
    down = false;
    expect(await s.check([idea({ versions: [v] })])).toBe(true);
    expect(s.results.get(v.recordId)?.state).toBe("confirmed");
  });
  it("asks each explorer once per block height, however many versions sit in that block", async () => {
    const x = confirmedVersion(7), y = confirmedVersion(7);
    const log: number[] = [];
    const s = new ConfirmSession({ a: explorer([x.block], log), b: explorer([x.block], log) });
    await s.check([idea({ versions: [x.v, y.v] })]);
    expect(log).toEqual([870_000, 870_000]); // one per explorer
  });
  it("clear() forgets everything (the lock)", async () => {
    const { v, block } = confirmedVersion(8);
    const s = new ConfirmSession({ a: explorer([block], []), b: explorer([block], []) });
    await s.check([idea({ versions: [v] })]);
    s.clear();
    expect(s.results.size).toBe(0);
  });
});
