import { getValidAccessToken } from "./tokens";
import { querySearchAnalytics } from "./client";
import { resolveSnapshotDateRanges } from "./dateRange";
import { computeSnapshot, type PerformanceSnapshot } from "./snapshot";

export type SiteSnapshotResult =
  | { status: "ok"; snapshot: PerformanceSnapshot }
  | { status: "not_connected" }
  | { status: "needs_reauth" }
  | { status: "error"; message: string };

/**
 * The latest-available-28-days performance snapshot (plus the immediately
 * preceding comparable 28 days) for one site's associated Search Console
 * property. `organizationId` must already be verified by the caller to
 * belong to the requesting user; `propertySiteUrl` must already be the
 * site's persisted `search_console_property_url` (not client-supplied).
 */
export async function getSiteSearchConsoleSnapshot(
  organizationId: string,
  propertySiteUrl: string,
  referenceDate: Date = new Date(),
): Promise<SiteSnapshotResult> {
  const tokenResult = await getValidAccessToken(organizationId);
  if (!tokenResult.ok) {
    if (tokenResult.reason === "refresh_failed") {
      return { status: "error", message: "Could not refresh the Google Search Console connection." };
    }
    return { status: tokenResult.reason };
  }

  const { current, previous } = resolveSnapshotDateRanges(referenceDate);

  const [currentResult, previousResult] = await Promise.all([
    querySearchAnalytics(tokenResult.accessToken, propertySiteUrl, current),
    querySearchAnalytics(tokenResult.accessToken, propertySiteUrl, previous),
  ]);

  if (!currentResult.ok) return { status: "error", message: currentResult.error };
  if (!previousResult.ok) return { status: "error", message: previousResult.error };

  return {
    status: "ok",
    snapshot: computeSnapshot(currentResult.rows, previousResult.rows, { current, previous }),
  };
}
