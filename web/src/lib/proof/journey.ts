// The proof journey of one version (5.8): five steps, each with the state this browser really found. Pure.
import type { VersionView } from "../model/read-model";
import type { Source } from "../versions/source";

export type StepKey = "recorded" | "fingerprint" | "signed" | "github" | "chain";
export type StepState = "done" | "doing" | "todo" | "warn";
export type StepNote = "checking" | "unlinked" | "uploading" | "failed" | "different" | "changed" | "fingerprintOnly" | "waiting" | "mismatch" | "invalid";
export interface Step { key: StepKey; state: StepState; note: StepNote | null }

const step = (key: StepKey, state: StepState, note: StepNote | null = null): Step => ({ key, state, note });

function githubStep(s: Source | null): Step {
  if (!s) return step("github", "doing", "checking");
  switch (s.kind) {
    case "unlinked": return step("github", "todo", "unlinked");
    case "not_yet": return step("github", "doing", "uploading");
    case "failed": return step("github", "warn", "failed");
    case "ready": {
      const o = s.original;
      if (o.kind === "no_original") return step("github", "done", "fingerprintOnly");
      if (o.kind === "mismatch") return step("github", "warn", "different");
      if (o.kind === "unreadable") return step("github", "warn", "failed");
      return o.same ? step("github", "done") : step("github", "warn", "changed");
    }
  }
}

function chainStep(a: VersionView["server"]["anchor"]): Step {
  switch (a) {
    case "confirmed": return step("chain", "done");
    case "server_confirmed": return step("chain", "doing", "checking"); // the server's word alone is never 확정
    case "pending": return step("chain", "doing", "waiting");
    case "mismatch": return step("chain", "warn", "mismatch");
    case "invalid": return step("chain", "warn", "invalid");
  }
}

/** The first three steps are what the browser already verified to show the version at all (signature, chain of records). */
export function journeyOf(v: VersionView, source: Source | null): Step[] {
  return [step("recorded", "done"), step("fingerprint", "done"), step("signed", "done"), githubStep(source), chainStep(v.server.anchor)];
}
