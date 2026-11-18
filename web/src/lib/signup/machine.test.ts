import { describe, expect, it } from "vitest";
import { canSkipRecovery, initialState, reduce, stepNumber, type SignupEvent, type SignupState } from "./machine";

const run = (events: SignupEvent[], from: SignupState = initialState) => events.reduce(reduce, from);
const toPhone: SignupEvent[] = [{ type: "checked" }, { type: "begin" }, { type: "pc_done" }];

describe("signup state machine", () => {
  it("walks 0 → 5 → done, ticking the checklist", () => {
    const s = run([...toPhone, { type: "phone_done" }, { type: "github_done" }, { type: "recovery_done" }, { type: "folders_done", count: 2 }]);
    expect(s.step).toBe("done");
    expect(s.done).toEqual({ pc: true, phone: true, github: true, recovery: true, folders: true });
    expect(s.foldersChosen).toBe(2);
  });
  it("makes the recovery key mandatory when the phone is skipped", () => {
    const s = run([...toPhone, { type: "phone_skip" }, { type: "github_later" }]);
    expect(s.step).toBe("recovery");
    expect(canSkipRecovery(s)).toBe(false);
    expect(reduce(s, { type: "recovery_later" })).toBe(s);
  });
  it("allows [나중에] for the recovery key after a phone was registered", () => {
    const s = run([...toPhone, { type: "phone_done" }, { type: "github_later" }, { type: "recovery_later" }]);
    expect(s.step).toBe("folders");
    expect(s.recoveryLater).toBe(true);
    expect(s.done.recovery).toBe(false);
  });
  it("ignores events that belong to another step", () => {
    const s = run([{ type: "checked" }]);
    expect(reduce(s, { type: "pc_done" })).toBe(s);
  });
  it("stops from anywhere and remembers why", () => {
    const s = run([{ type: "checked" }, { type: "stop", reason: "prf_missing" }]);
    expect(s.step).toBe("stopped");
    expect(s.stop).toBe("prf_missing");
  });
  it("lets the done screen record a later GitHub connection", () => {
    const s = run([...toPhone, { type: "phone_done" }, { type: "github_later" }, { type: "recovery_done" }, { type: "folders_done", count: 0 }, { type: "github_done" }]);
    expect(s.step).toBe("done");
    expect(s.githubLater).toBe(false);
    expect(s.done.github).toBe(true);
  });
  it("remembers what was just finished, for the next screen's short confirmation", () => {
    expect(run(toPhone).justDid).toBe("pc");
    expect(run([...toPhone, { type: "phone_done" }]).justDid).toBe("phone");
    expect(run([...toPhone, { type: "phone_skip" }]).justDid).toBeNull(); // a skip made nothing
    expect(run([...toPhone, { type: "phone_skip" }, { type: "github_done" }]).justDid).toBe("github");
    expect(run([...toPhone, { type: "phone_done" }, { type: "github_later" }]).justDid).toBeNull();
    const end = run([...toPhone, { type: "phone_done" }, { type: "github_later" }, { type: "recovery_done" }]);
    expect(end.justDid).toBe("recovery");
    expect(reduce(end, { type: "folders_done", count: 1 }).justDid).toBe("folders");
    expect(initialState.justDid).toBeNull();
  });
  it("numbers only steps 1..5", () => {
    expect(["intro", "pc", "phone", "github", "recovery", "folders", "done"].map((x) => stepNumber(x as SignupState["step"]))).toEqual([null, 1, 2, 3, 4, 5, null]);
  });
  it("never mutates the previous state", () => {
    const s = run([{ type: "checked" }, { type: "begin" }]);
    const before = JSON.stringify(s);
    reduce(s, { type: "pc_done" });
    expect(JSON.stringify(s)).toBe(before);
  });
});
