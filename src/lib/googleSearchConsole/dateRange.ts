/**
 * Search Console's own data typically lags a few days behind today — see
 * https://support.google.com/webmasters/answer/96568 ("Data in Search
 * Console is usually 2 to 3 days behind"). Rather than fabricate a "latest
 * 28 days" window that includes days Google hasn't finished processing yet
 * (which would just come back as zeros, misreadable as "no traffic"), MARKO
 * assumes a fixed, documented lag and treats `today - GSC_DATA_LAG_DAYS` as
 * the latest date with reliable data. This is a conservative MVP
 * approximation, not a live check against what Google actually has
 * available yet — see PROJECT_STATUS.md's Known limitations.
 */
export const GSC_DATA_LAG_DAYS = 3;

export const SNAPSHOT_WINDOW_DAYS = 28;

export type DateRange = { startDate: string; endDate: string };

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * The latest available 28-day window (ending `GSC_DATA_LAG_DAYS` before
 * `referenceDate`) and the immediately preceding, equal-length 28-day
 * window — so a caller can compute a simple factual delta between the two.
 * Pure and deterministic: `referenceDate` defaults to `new Date()` but is
 * always overridable for testing.
 */
export function resolveSnapshotDateRanges(referenceDate: Date = new Date()): {
  current: DateRange;
  previous: DateRange;
} {
  const currentEnd = addUtcDays(referenceDate, -GSC_DATA_LAG_DAYS);
  const currentStart = addUtcDays(currentEnd, -(SNAPSHOT_WINDOW_DAYS - 1));
  const previousEnd = addUtcDays(currentStart, -1);
  const previousStart = addUtcDays(previousEnd, -(SNAPSHOT_WINDOW_DAYS - 1));

  return {
    current: { startDate: toIsoDate(currentStart), endDate: toIsoDate(currentEnd) },
    previous: { startDate: toIsoDate(previousStart), endDate: toIsoDate(previousEnd) },
  };
}
