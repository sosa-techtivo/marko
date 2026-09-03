import { describe, expect, it } from "vitest";
import { GSC_DATA_LAG_DAYS, SNAPSHOT_WINDOW_DAYS, resolveSnapshotDateRanges } from "./dateRange";

describe("resolveSnapshotDateRanges", () => {
  it("ends the current period GSC_DATA_LAG_DAYS before the reference date, not on it", () => {
    // Search Console data lags — the window must never assume "today" has
    // data (see the module doc comment / this milestone's explicit rule).
    const reference = new Date("2026-09-02T12:00:00.000Z");
    const { current } = resolveSnapshotDateRanges(reference);
    expect(current.endDate).toBe("2026-08-30"); // 2026-09-02 minus 3 days
    expect(GSC_DATA_LAG_DAYS).toBe(3);
  });

  it("spans exactly SNAPSHOT_WINDOW_DAYS (28) inclusive days for the current period", () => {
    const reference = new Date("2026-09-02T00:00:00.000Z");
    const { current } = resolveSnapshotDateRanges(reference);
    const days =
      (Date.parse(current.endDate) - Date.parse(current.startDate)) / (1000 * 60 * 60 * 24) + 1;
    expect(days).toBe(SNAPSHOT_WINDOW_DAYS);
    expect(current).toEqual({ startDate: "2026-08-03", endDate: "2026-08-30" });
  });

  it("the previous period ends the day immediately before the current period starts", () => {
    const reference = new Date("2026-09-02T00:00:00.000Z");
    const { current, previous } = resolveSnapshotDateRanges(reference);
    const dayBeforeCurrentStart = new Date(Date.parse(current.startDate) - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    expect(previous.endDate).toBe(dayBeforeCurrentStart);
  });

  it("the previous period is also exactly 28 days and does not overlap the current period", () => {
    const reference = new Date("2026-09-02T00:00:00.000Z");
    const { current, previous } = resolveSnapshotDateRanges(reference);
    const days =
      (Date.parse(previous.endDate) - Date.parse(previous.startDate)) / (1000 * 60 * 60 * 24) + 1;
    expect(days).toBe(SNAPSHOT_WINDOW_DAYS);
    expect(Date.parse(previous.endDate)).toBeLessThan(Date.parse(current.startDate));
    expect(previous).toEqual({ startDate: "2026-07-06", endDate: "2026-08-02" });
  });

  it("is deterministic for the same reference date", () => {
    const reference = new Date("2026-01-15T09:30:00.000Z");
    expect(resolveSnapshotDateRanges(reference)).toEqual(resolveSnapshotDateRanges(reference));
  });
});
