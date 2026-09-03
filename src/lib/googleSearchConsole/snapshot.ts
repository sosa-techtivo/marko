import type { DateRange } from "./dateRange";

export type SearchAnalyticsRow = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type PeriodMetrics = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  /** False when Search Console returned no rows for this period — distinct
   * from genuinely-zero traffic, so the UI can say "no data" rather than
   * implying "0 clicks" is a measured fact. */
  hasData: boolean;
};

const EMPTY_METRICS: PeriodMetrics = { clicks: 0, impressions: 0, ctr: 0, position: 0, hasData: false };

/**
 * Aggregates Search Console rows for one period into simple totals/
 * averages. A no-dimension `searchAnalytics.query` call (what MARKO always
 * makes) returns at most one already-aggregated row, but this stays
 * correct if more than one ever comes back: clicks/impressions sum, and
 * ctr/position — already per-row averages from Google — are recombined as
 * an impressions-weighted average rather than a naive mean of averages.
 */
export function aggregateSearchAnalyticsRows(rows: SearchAnalyticsRow[]): PeriodMetrics {
  if (rows.length === 0) return EMPTY_METRICS;

  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const ctr =
    impressions > 0 ? rows.reduce((sum, row) => sum + row.ctr * row.impressions, 0) / impressions : 0;
  const position =
    impressions > 0
      ? rows.reduce((sum, row) => sum + row.position * row.impressions, 0) / impressions
      : 0;

  return { clicks, impressions, ctr, position, hasData: true };
}

export type SnapshotDelta = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type PerformanceSnapshot = {
  current: PeriodMetrics;
  previous: PeriodMetrics;
  /** Null when either period has no data — a delta against a missing
   * baseline isn't a fact worth reporting. Purely factual numbers: MARKO
   * never labels a delta as an "improvement" or "regression" here — see
   * CLAUDE.md's AI Usage Principles and this milestone's explicit scope. */
  delta: SnapshotDelta | null;
  dateRanges: { current: DateRange; previous: DateRange };
};

export function computeSnapshot(
  currentRows: SearchAnalyticsRow[],
  previousRows: SearchAnalyticsRow[],
  dateRanges: { current: DateRange; previous: DateRange },
): PerformanceSnapshot {
  const current = aggregateSearchAnalyticsRows(currentRows);
  const previous = aggregateSearchAnalyticsRows(previousRows);

  const delta: SnapshotDelta | null =
    current.hasData && previous.hasData
      ? {
          clicks: current.clicks - previous.clicks,
          impressions: current.impressions - previous.impressions,
          ctr: current.ctr - previous.ctr,
          position: current.position - previous.position,
        }
      : null;

  return { current, previous, delta, dateRanges };
}
