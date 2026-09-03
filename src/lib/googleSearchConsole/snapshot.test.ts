import { describe, expect, it } from "vitest";
import { aggregateSearchAnalyticsRows, computeSnapshot, type SearchAnalyticsRow } from "./snapshot";

const DATE_RANGES = {
  current: { startDate: "2026-08-03", endDate: "2026-08-30" },
  previous: { startDate: "2026-07-06", endDate: "2026-08-02" },
};

function row(overrides: Partial<SearchAnalyticsRow> = {}): SearchAnalyticsRow {
  return { clicks: 0, impressions: 0, ctr: 0, position: 0, ...overrides };
}

describe("aggregateSearchAnalyticsRows", () => {
  it("marks an empty row set as having no data, not zero traffic", () => {
    const result = aggregateSearchAnalyticsRows([]);
    expect(result.hasData).toBe(false);
    expect(result).toMatchObject({ clicks: 0, impressions: 0, ctr: 0, position: 0 });
  });

  it("passes through a single no-dimension aggregate row as-is", () => {
    const result = aggregateSearchAnalyticsRows([
      row({ clicks: 120, impressions: 4000, ctr: 0.03, position: 8.4 }),
    ]);
    expect(result).toEqual({ clicks: 120, impressions: 4000, ctr: 0.03, position: 8.4, hasData: true });
  });

  it("sums clicks/impressions and computes an impressions-weighted average ctr/position across multiple rows", () => {
    const result = aggregateSearchAnalyticsRows([
      row({ clicks: 10, impressions: 100, ctr: 0.1, position: 5 }),
      row({ clicks: 30, impressions: 300, ctr: 0.1, position: 10 }),
    ]);
    expect(result.clicks).toBe(40);
    expect(result.impressions).toBe(400);
    expect(result.ctr).toBeCloseTo(0.1, 10);
    // weighted: (5*100 + 10*300) / 400 = (500 + 3000) / 400 = 8.75
    expect(result.position).toBeCloseTo(8.75, 10);
    expect(result.hasData).toBe(true);
  });
});

describe("computeSnapshot", () => {
  it("computes a factual delta when both periods have data", () => {
    const current = [row({ clicks: 150, impressions: 5000, ctr: 0.03, position: 7 })];
    const previous = [row({ clicks: 100, impressions: 4000, ctr: 0.025, position: 9 })];

    const snapshot = computeSnapshot(current, previous, DATE_RANGES);

    expect(snapshot.delta).not.toBeNull();
    expect(snapshot.delta).toEqual({
      clicks: 50,
      impressions: 1000,
      ctr: expect.closeTo(0.005, 10),
      position: -2,
    });
  });

  it("produces a negative position delta when average position improves (moves toward 1)", () => {
    const current = [row({ clicks: 10, impressions: 100, ctr: 0.1, position: 4 })];
    const previous = [row({ clicks: 10, impressions: 100, ctr: 0.1, position: 9 })];
    const snapshot = computeSnapshot(current, previous, DATE_RANGES);
    expect(snapshot.delta?.position).toBe(-5);
  });

  it("returns a null delta when the current period has no data", () => {
    const previous = [row({ clicks: 100, impressions: 4000, ctr: 0.025, position: 9 })];
    const snapshot = computeSnapshot([], previous, DATE_RANGES);
    expect(snapshot.current.hasData).toBe(false);
    expect(snapshot.delta).toBeNull();
  });

  it("returns a null delta when the previous period has no data (e.g. a brand-new site)", () => {
    const current = [row({ clicks: 150, impressions: 5000, ctr: 0.03, position: 7 })];
    const snapshot = computeSnapshot(current, [], DATE_RANGES);
    expect(snapshot.previous.hasData).toBe(false);
    expect(snapshot.delta).toBeNull();
  });

  it("returns a null delta when neither period has data", () => {
    const snapshot = computeSnapshot([], [], DATE_RANGES);
    expect(snapshot.delta).toBeNull();
  });

  it("carries the given date ranges through unchanged", () => {
    const snapshot = computeSnapshot([], [], DATE_RANGES);
    expect(snapshot.dateRanges).toEqual(DATE_RANGES);
  });
});
