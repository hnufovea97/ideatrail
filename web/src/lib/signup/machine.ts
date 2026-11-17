// The signup flow as a pure reducer: screens dispatch events, this decides the next step.

export type Step = "check" | "intro" | "pc" | "phone" | "github" | "recovery" | "folders" | "done" | "stopped";
export type StopReason = "no_link" | "link_mismatch" | "link_expired" | "link_used" | "no_prf" | "prf_missing" | "offline";
export interface Checklist { pc: boolean; phone: boolean; github: boolean; recovery: boolean; folders: boolean }

export interface SignupState {
  step: Step;
  stop: StopReason | null;
  phoneSkipped: boolean;
  githubLater: boolean;
  recoveryLater: boolean;
  foldersChosen: number | null;
  done: Checklist;
}

export type SignupEvent =
  | { type: "checked" } | { type: "begin" } | { type: "stop"; reason: StopReason }
  | { type: "pc_done" } | { type: "phone_done" } | { type: "phone_skip" }
  | { type: "github_done" } | { type: "github_later" }
  | { type: "recovery_done" } | { type: "recovery_later" }
  | { type: "folders_done"; count: number };

export const initialState: SignupState = {
  step: "check", stop: null, phoneSkipped: false, githubLater: false, recoveryLater: false, foldersChosen: null,
  done: { pc: false, phone: false, github: false, recovery: false, folders: false },
};

const NUMBERS: Partial<Record<Step, number>> = { pc: 1, phone: 2, github: 3, recovery: 4, folders: 5 };
export const stepNumber = (step: Step): number | null => NUMBERS[step] ?? null;

/** No [나중에] for the recovery key when no second device exists (UX ⑤-2). */
export const canSkipRecovery = (s: SignupState): boolean => !s.phoneSkipped;

const tick = (s: SignupState, key: keyof Checklist): Checklist => ({ ...s.done, [key]: true });

export function reduce(s: SignupState, e: SignupEvent): SignupState {
  if (e.type === "stop") return { ...s, step: "stopped", stop: e.reason };
  switch (s.step) {
    case "check":
      return e.type === "checked" ? { ...s, step: "intro" } : s;
    case "intro":
      return e.type === "begin" ? { ...s, step: "pc" } : s;
    case "pc":
      return e.type === "pc_done" ? { ...s, step: "phone", done: tick(s, "pc") } : s;
    case "phone":
      if (e.type === "phone_done") return { ...s, step: "github", done: tick(s, "phone") };
      if (e.type === "phone_skip") return { ...s, step: "github", phoneSkipped: true };
      return s;
    case "github":
      if (e.type === "github_done") return { ...s, step: "recovery", githubLater: false, done: tick(s, "github") };
      if (e.type === "github_later") return { ...s, step: "recovery", githubLater: true };
      return s;
    case "recovery":
      if (e.type === "recovery_done") return { ...s, step: "folders", done: tick(s, "recovery") };
      if (e.type === "recovery_later" && canSkipRecovery(s)) return { ...s, step: "folders", recoveryLater: true };
      return s;
    case "folders":
      return e.type === "folders_done" ? { ...s, step: "done", foldersChosen: e.count, done: tick(s, "folders") } : s;
    case "done":
      return e.type === "github_done" ? { ...s, githubLater: false, done: tick(s, "github") } : s;
    default:
      return s;
  }
}
