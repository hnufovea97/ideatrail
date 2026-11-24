// Puts the browser's own confirmation results on the read model. Only here can a version become "confirmed" (확산됨);
// a result never lifts a version the server has not confirmed. Pure and immutable.
import type { IdeaView, VersionView } from "../model/read-model";
import type { Confirmation } from "./confirm";

function overlaid(v: VersionView, c: Confirmation | undefined): VersionView {
  if (!c || v.server.anchor !== "server_confirmed") return v;
  switch (c.state) {
    case "confirmed": return { ...v, server: { ...v.server, anchor: "confirmed", blockHeight: c.height } };
    case "mismatch": return { ...v, server: { ...v.server, anchor: "mismatch" } };
    case "invalid": return { ...v, server: { ...v.server, anchor: "invalid" } };
    case "checking": return v;
  }
}

export function withConfirmations(ideas: readonly IdeaView[], results: ReadonlyMap<string, Confirmation>): IdeaView[] {
  return ideas.map((i) => ({ ...i, versions: i.versions.map((v) => overlaid(v, results.get(v.recordId))) }));
}
