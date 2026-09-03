import type { SearchConsoleProperty } from "./propertyMatching";
import type { SearchAnalyticsRow } from "./snapshot";
import type { DateRange } from "./dateRange";

const WEBMASTERS_BASE = "https://www.googleapis.com/webmasters/v3";

/**
 * Deliberately status-code-only, never Google's raw JSON error body: that
 * body can echo back request context, and this string may be shown
 * directly to the user, so nothing that could resemble a credential or
 * account identifier is ever forwarded into it.
 */
function describeGoogleApiError(status: number): string {
  if (status === 401) {
    return "Google rejected the request — the Search Console connection may need to be reconnected.";
  }
  if (status === 403) {
    return "This Google account does not have access to that Search Console property.";
  }
  if (status === 429) {
    return "Google Search Console rate-limited this request. Please try again shortly.";
  }
  return `Google Search Console returned an unexpected error (HTTP ${status}).`;
}

export type ListPropertiesResult =
  | { ok: true; properties: SearchConsoleProperty[] }
  | { ok: false; error: string };

/** The Search Console properties (both URL-prefix and Domain) the
 * connected Google account has any level of access to. */
export async function listSearchConsoleProperties(accessToken: string): Promise<ListPropertiesResult> {
  let response: Response;
  try {
    response = await fetch(`${WEBMASTERS_BASE}/sites`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return { ok: false, error: "Could not reach Google Search Console." };
  }

  if (!response.ok) {
    return { ok: false, error: describeGoogleApiError(response.status) };
  }

  let payload: { siteEntry?: SearchConsoleProperty[] };
  try {
    payload = (await response.json()) as { siteEntry?: SearchConsoleProperty[] };
  } catch {
    return { ok: false, error: "Google Search Console returned an unreadable response." };
  }

  return { ok: true, properties: payload.siteEntry ?? [] };
}

export type QueryPerformanceResult =
  | { ok: true; rows: SearchAnalyticsRow[] }
  | { ok: false; error: string };

/** Aggregate performance for one property over one date range — queried
 * with no dimensions, so Google returns at most one already-summed row
 * (see snapshot.ts's aggregateSearchAnalyticsRows for how that's turned
 * into totals/averages). */
export async function querySearchAnalytics(
  accessToken: string,
  siteUrl: string,
  range: DateRange,
): Promise<QueryPerformanceResult> {
  let response: Response;
  try {
    response = await fetch(
      `${WEBMASTERS_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ startDate: range.startDate, endDate: range.endDate }),
      },
    );
  } catch {
    return { ok: false, error: "Could not reach Google Search Console." };
  }

  if (!response.ok) {
    return { ok: false, error: describeGoogleApiError(response.status) };
  }

  let payload: { rows?: SearchAnalyticsRow[] };
  try {
    payload = (await response.json()) as { rows?: SearchAnalyticsRow[] };
  } catch {
    return { ok: false, error: "Google Search Console returned an unreadable response." };
  }

  return { ok: true, rows: payload.rows ?? [] };
}
