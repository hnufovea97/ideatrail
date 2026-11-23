import { afterEach, describe, expect, it, vi } from "vitest";
import { bindActivity, startAutoLock } from "./autolock";
import { wipeVault } from "./unlock";

const MIN = 60_000;
const vault = () => ({ userId: "u", mk: new Uint8Array(32).fill(1), akPriv: new Uint8Array(32).fill(2), akPub: new Uint8Array(32) });
const zero = (b: Uint8Array) => b.every((x) => x === 0);

afterEach(() => vi.useRealTimers());

describe("auto-lock (5.1)", () => {
  it("after 5 idle minutes the in-memory keys are zero", () => {
    vi.useFakeTimers();
    const v = vault();
    let locks = 0;
    startAutoLock(5, () => { wipeVault(v); locks++; });
    vi.advanceTimersByTime(5 * MIN - 1);
    expect(v.mk[0]).toBe(1);
    vi.advanceTimersByTime(1);
    expect(zero(v.mk) && zero(v.akPriv)).toBe(true);
    expect(locks).toBe(1);
  });
  it("activity after the limit has already passed (a sleeping tab) locks instead of pushing it back", () => {
    vi.useFakeTimers();
    let locks = 0;
    const lock = startAutoLock(5, () => locks++);
    vi.setSystemTime(Date.now() + 6 * MIN); // the clock jumps, the timer has not fired
    lock.touch();
    expect(locks).toBe(1);
  });
  it("activity pushes the lock back", () => {
    vi.useFakeTimers();
    let locks = 0;
    const lock = startAutoLock(5, () => locks++);
    vi.advanceTimersByTime(4 * MIN);
    lock.touch();
    vi.advanceTimersByTime(4 * MIN);
    expect(locks).toBe(0);
    vi.advanceTimersByTime(MIN);
    expect(locks).toBe(1);
  });
  it("a tab whose timers slept past the limit locks as soon as it is checked", () => {
    vi.useFakeTimers();
    let locks = 0;
    const lock = startAutoLock(5, () => locks++);
    vi.setSystemTime(Date.now() + 6 * MIN); // the clock moved, no timer ran (background tab)
    lock.check();
    expect(locks).toBe(1);
  });
  it("stop() means no lock later, and a lock fires only once", () => {
    vi.useFakeTimers();
    let locks = 0;
    startAutoLock(5, () => locks++).stop();
    vi.advanceTimersByTime(10 * MIN);
    expect(locks).toBe(0);
    const again = startAutoLock(1, () => locks++);
    vi.advanceTimersByTime(MIN);
    again.check();
    again.touch();
    vi.advanceTimersByTime(5 * MIN);
    expect(locks).toBe(1);
  });
  it("bindActivity: a key press touches, coming back to the tab checks", () => {
    vi.useFakeTimers();
    let locks = 0;
    const lock = startAutoLock(5, () => locks++);
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    const unbind = bindActivity(win, doc, lock);
    vi.advanceTimersByTime(4 * MIN);
    win.dispatchEvent(new Event("keydown"));
    vi.advanceTimersByTime(4 * MIN);
    expect(locks).toBe(0);
    vi.setSystemTime(Date.now() + 2 * MIN);
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(locks).toBe(1);
    unbind();
  });
});
