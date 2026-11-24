import { describe, expect, it } from "vitest";
import { dayRange, daysSince, monthDay, shortDate } from "./format";

const SEOUL = "Asia/Seoul";

describe("home dates", () => {
  it("writes YY.MM.DD in the viewer's time zone (founder: 최초 기록 26.11.03)", () => {
    expect(shortDate("2026-11-03T01:00:00Z", SEOUL)).toBe("26.11.03");
    expect(shortDate("2026-11-02T16:00:00Z", SEOUL)).toBe("26.11.03"); // already the 3rd in Seoul
    expect(shortDate("2026-11-02T16:00:00Z", "UTC")).toBe("26.11.02");
  });
  it("writes MM.DD and a range that collapses to one day", () => {
    expect(monthDay("2026-11-18T03:00:00Z", SEOUL)).toBe("11.18");
    expect(dayRange("2026-11-10T00:00:00Z", "2026-11-18T00:00:00Z", SEOUL)).toBe("11.10 – 11.18");
    expect(dayRange("2026-11-10T00:00:00Z", "2026-11-10T09:00:00Z", SEOUL)).toBe("11.10");
  });
  it("counts whole days and never goes negative", () => {
    expect(daysSince("2026-11-01T00:00:00Z", new Date("2026-11-24T00:00:00Z"))).toBe(23);
    expect(daysSince("2026-11-25T00:00:00Z", new Date("2026-11-24T00:00:00Z"))).toBe(0);
  });
});
