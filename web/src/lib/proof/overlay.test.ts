import { describe, expect, it } from "vitest";
import { idea, version } from "../home/fixtures";
import type { Confirmation } from "./confirm";
import { withConfirmations } from "./overlay";

const confirmed: Confirmation = { state: "confirmed", height: 870_001, time: "2026-11-20T00:00:00.000Z" };

describe("withConfirmations", () => {
  const a = version({ anchor: "server_confirmed" });
  const b = version({ anchor: "server_confirmed" });
  const c = version({ anchor: "pending" });
  const ideas = [idea({ versions: [a, b, c] })];
  const anchors = (out: ReturnType<typeof withConfirmations>) => out[0].versions.map((v) => v.server.anchor);

  it("a version is 'confirmed' only with the browser's own confirmed result; its height is the checked one", () => {
    const out = withConfirmations(ideas, new Map([[a.recordId, confirmed]]));
    expect(anchors(out)).toEqual(["confirmed", "server_confirmed", "pending"]);
    expect(out[0].versions[0].server.blockHeight).toBe(870_001);
  });
  it("mismatch and invalid show as such; checking changes nothing", () => {
    const out = withConfirmations(ideas, new Map<string, Confirmation>([[a.recordId, { state: "mismatch" }], [b.recordId, { state: "invalid" }]]));
    expect(anchors(out)).toEqual(["mismatch", "invalid", "pending"]);
    expect(anchors(withConfirmations(ideas, new Map([[a.recordId, { state: "checking" }]])))).toEqual(["server_confirmed", "server_confirmed", "pending"]);
  });
  it("never lets a result lift a version the server has not confirmed, and never mutates the input", () => {
    const out = withConfirmations(ideas, new Map([[c.recordId, confirmed]]));
    expect(anchors(out)).toEqual(["server_confirmed", "server_confirmed", "pending"]);
    expect(a.server.anchor).toBe("server_confirmed");
    expect(out[0]).not.toBe(ideas[0]);
  });
});
