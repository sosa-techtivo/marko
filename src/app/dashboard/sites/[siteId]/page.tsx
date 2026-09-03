import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUserAndOrganization } from "@/lib/organizations";
import { runSeoAnalysis } from "./actions";
import { buildSeoHealthReport } from "@/lib/reporting/seoHealthReport";
import { buildSeoChangeReport } from "@/lib/reporting/seoChangeReport";
import { isBotProtectionFailureMessage } from "@/lib/crawler/botProtection";
import { checkSiteEmbeddable } from "@/lib/preview/checkEmbeddable";
import { WebsitePreviewCard } from "@/components/WebsitePreviewCard";
import { SiteHealthGauge, HealthIndicator } from "@/components/SitesGrid";
import { deriveSiteHealthSummary } from "@/lib/reporting/siteHealthStatus";
import { StatusBadge, SummaryStat } from "@/components/seoReport/badges";
import { OpportunitiesList } from "@/components/seoReport/OpportunitiesList";
import { AnalyzedPagesTable } from "@/components/seoReport/AnalyzedPagesTable";
import { AnalysisHistorySection } from "@/components/seoReport/AnalysisHistoryList";
import { SeoProgressChart } from "@/components/seoReport/SeoProgressChart";
import { ChangesSinceLastAnalysisCard } from "@/components/seoReport/ChangesSinceLastAnalysisCard";

// The seed page fetch plus MAX_ADDITIONAL_PAGES more, fetched in small
// concurrent batches (see FETCH_CONCURRENCY in runCrawl.ts) rather than
// one at a time — each still bounded by fetchPage's own per-page timeout.
// Worst case ≈ 40s (see runCrawl.ts's FETCH_CONCURRENCY doc comment for
// the exact math); this gives Vercel's default 10s function timeout
// enough headroom to not cut a legitimate crawl short.
export const maxDuration = 60;

export default async function SiteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { siteId } = await params;
  const { error } = await searchParams;
  const { organization } = await requireUserAndOrganization();

  if (!organization) {
    notFound();
  }

  const supabase = await createClient();

  const { data: site } = await supabase
    .from("sites")
    .select("id, name, url, favicon_url")
    .eq("id", siteId)
    .eq("organization_id", organization.id)
    .maybeSingle();

  if (!site) {
    notFound();
  }

  // Kicked off now (not awaited until render) so this independent, up-to-5s
  // header check runs concurrently with the Supabase queries below instead
  // of adding to their total latency.
  const embedCheckPromise = checkSiteEmbeddable(site.url);

  const { data: latestRun } = await supabase
    .from("crawl_runs")
    .select("id, status, started_at, completed_at, pages_crawled, error_message")
    .eq("site_id", site.id)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Independent of `latestRun` above (which may be running/failed —
  // including a bot-protection-blocked attempt): the SEO report, the
  // Historical Changes comparison, and the SEO progress chart are all
  // sourced from *completed* runs only, so a failed latest attempt never
  // replaces or hides the last genuinely successful report. Newest-first;
  // capped well above the 2 the change report needs so the same query also
  // covers the progress chart below (whether there are enough completed
  // analyses to show one at all comes straight from this array's length).
  const PROGRESS_CHART_RUN_LIMIT = 20;
  const { data: completedRuns } = await supabase
    .from("crawl_runs")
    .select("id, started_at, completed_at")
    .eq("site_id", site.id)
    .eq("status", "completed")
    .order("started_at", { ascending: false })
    .limit(PROGRESS_CHART_RUN_LIMIT);

  const latestCompletedRun = completedRuns?.[0] ?? null;
  const previousCompletedRun = completedRuns?.[1] ?? null;
  const hasMultipleCompletedAnalyses = (completedRuns?.length ?? 0) >= 2;

  // A separate, additive query (any status, not just completed) purely for
  // the "Analysis history" list — doesn't affect `latestRun`/`completedRuns`
  // above or anything derived from them (health report, change report).
  // Capped at 5 so the right column can't grow indefinitely; no "view all"
  // yet, per current scope.
  const HISTORY_RUN_LIMIT = 5;
  const { data: recentRuns } = await supabase
    .from("crawl_runs")
    .select("id, status, started_at, completed_at, pages_crawled, error_message")
    .eq("site_id", site.id)
    .order("started_at", { ascending: false })
    .limit(HISTORY_RUN_LIMIT);

  const completedRecentRunIds = (recentRuns ?? [])
    .filter((run) => run.status === "completed")
    .map((run) => run.id);

  const { data: recentRunIssues } =
    completedRecentRunIds.length > 0
      ? await supabase
          .from("crawl_issues")
          .select("id, crawl_run_id")
          .in("crawl_run_id", completedRecentRunIds)
      : { data: null };

  const issueCountByRunId = new Map<string, number>();
  for (const issue of recentRunIssues ?? []) {
    issueCountByRunId.set(issue.crawl_run_id, (issueCountByRunId.get(issue.crawl_run_id) ?? 0) + 1);
  }

  const { data: crawlPages } = latestCompletedRun
    ? await supabase
        .from("crawl_pages")
        .select(
          "id, url, http_status, title, meta_description, h1, canonical_url, is_indexable",
        )
        .eq("crawl_run_id", latestCompletedRun.id)
        .order("created_at", { ascending: true })
    : { data: null };

  const { data: crawlIssues } = latestCompletedRun
    ? await supabase
        .from("crawl_issues")
        .select("id, crawl_page_id, issue_type, severity, message")
        .eq("crawl_run_id", latestCompletedRun.id)
    : { data: null };

  const healthReport = latestCompletedRun
    ? buildSeoHealthReport(crawlPages ?? [], crawlIssues ?? [])
    : null;

  // Same categorical status/logic as the dashboard cards (SitesGrid) — no
  // separate scoring is introduced here.
  const siteHealth = deriveSiteHealthSummary(latestCompletedRun ? (crawlIssues ?? []) : null);

  // SEO progress chart data — only fetched/built when there's actually a
  // trend to show (2+ completed analyses). `olderCompletedRuns` excludes
  // the latest one, since its totals are already known via
  // `healthReport.summary` above; only a lightweight {crawl_run_id,
  // issue_type} query is needed for the rest, reusing the exact same
  // deriveSiteHealthSummary used for `siteHealth` — no new scoring.
  const olderCompletedRuns = hasMultipleCompletedAnalyses ? (completedRuns ?? []).slice(1) : [];
  const olderCompletedRunIds = olderCompletedRuns.map((run) => run.id);

  const { data: olderRunIssues } =
    olderCompletedRunIds.length > 0
      ? await supabase
          .from("crawl_issues")
          .select("crawl_run_id, issue_type")
          .in("crawl_run_id", olderCompletedRunIds)
      : { data: null };

  const issueTypesByRunId = new Map<string, { issue_type: string }[]>();
  for (const issue of olderRunIssues ?? []) {
    const list = issueTypesByRunId.get(issue.crawl_run_id) ?? [];
    list.push(issue);
    issueTypesByRunId.set(issue.crawl_run_id, list);
  }

  const progressChartPoints =
    hasMultipleCompletedAnalyses && latestCompletedRun && healthReport
      ? [
          // `olderCompletedRuns` is newest-first; reversed here so the
          // older points come first, oldest overall to most-recent-of-the-
          // older, ahead of the single latest point appended after.
          ...[...olderCompletedRuns].reverse().map((run) => {
            const summary = deriveSiteHealthSummary(issueTypesByRunId.get(run.id) ?? []);
            return {
              date: run.completed_at ?? run.started_at,
              totalOpportunities: summary.totalIssues,
              highPriorityIssues: summary.highPriorityIssues,
            };
          }),
          {
            date: latestCompletedRun.completed_at ?? latestCompletedRun.started_at,
            totalOpportunities: healthReport.summary.totalIssues,
            highPriorityIssues: healthReport.summary.highPriorityIssues,
          },
        ]
      : [];

  // True whenever the report/table below is showing an older completed run
  // than the absolute latest attempt (e.g. the latest attempt failed —
  // bot-blocked or otherwise — or is still running).
  const isShowingPreservedReport = Boolean(
    latestCompletedRun && latestRun && latestRun.id !== latestCompletedRun.id,
  );

  const { data: comparisonPages } = latestCompletedRun && previousCompletedRun
    ? await supabase
        .from("crawl_pages")
        .select("id, crawl_run_id, url, http_status, fetch_error")
        .in("crawl_run_id", [latestCompletedRun.id, previousCompletedRun.id])
    : { data: null };

  const { data: comparisonIssues } = latestCompletedRun && previousCompletedRun
    ? await supabase
        .from("crawl_issues")
        .select("crawl_run_id, crawl_page_id, issue_type")
        .in("crawl_run_id", [latestCompletedRun.id, previousCompletedRun.id])
    : { data: null };

  const changeReport = latestCompletedRun
    ? buildSeoChangeReport({
        latestRun: { id: latestCompletedRun.id, startedAt: latestCompletedRun.started_at },
        previousRun: previousCompletedRun
          ? { id: previousCompletedRun.id, startedAt: previousCompletedRun.started_at }
          : null,
        pages: comparisonPages ?? [],
        issues: comparisonIssues ?? [],
      })
    : null;

  const changeSummaryMessage =
    changeReport?.status === "compared"
      ? changeReport.summary.resolvedCount === 0 && changeReport.summary.newCount === 0
        ? "No SEO issue changes detected since the previous analysis."
        : [
            changeReport.summary.resolvedCount > 0
              ? `${changeReport.summary.resolvedCount} issue${changeReport.summary.resolvedCount === 1 ? "" : "s"} resolved`
              : null,
            changeReport.summary.newCount > 0
              ? `${changeReport.summary.newCount} new issue${changeReport.summary.newCount === 1 ? "" : "s"}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")
      : null;

  const embedCheck = await embedCheckPromise;

  const showsProgressCard = hasMultipleCompletedAnalyses && progressChartPoints.length > 0;
  // ROW 1 (Current SEO health / Website Preview / SEO progress / Changes
  // Since Last Analysis) adapts its column count to how many of those four
  // cards actually render — health and preview always do; the other two
  // are conditional on existing data, unchanged from before this pass.
  const rowOneCardCount = 2 + (showsProgressCard ? 1 : 0) + (changeReport ? 1 : 0);
  const rowOneGridColsClass =
    rowOneCardCount >= 4
      ? "lg:grid-cols-4"
      : rowOneCardCount === 3
        ? "lg:grid-cols-3"
        : "lg:grid-cols-2";

  return (
    <div className="flex flex-col gap-4">
      {/* Single compact context row — replaces the old stacked "Back to
          sites" link + separate name/URL/button block, so the dashboard
          cards below start right away instead of after two rows worth of
          vertical whitespace. `flex-wrap` lets the button drop to its own
          line if the left side runs out of room on very small screens. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          <Link
            href="/dashboard"
            className="shrink-0 text-zinc-500 hover:text-primary-strong"
          >
            ← Back to sites
          </Link>
          <span className="shrink-0 text-zinc-300" aria-hidden="true">
            |
          </span>
          <h1 className="min-w-0 truncate">
            <span className="font-semibold text-zinc-900">{site.name}</span>
            <span className="text-zinc-400"> · </span>
            <span className="text-zinc-500">{site.url}</span>
          </h1>
        </div>
        <form action={runSeoAnalysis} className="shrink-0">
          <input type="hidden" name="siteId" value={site.id} />
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Run SEO analysis
          </button>
        </form>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error === "crawl-start-failed"
            ? "Could not start the SEO analysis. Please try again."
            : "Something went wrong. Please try again."}
        </p>
      )}

      {!latestRun ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-16 text-center">
          <p className="text-sm font-medium text-zinc-900">No analysis yet</p>
          <p className="mt-1 text-sm text-zinc-500">
            Run an SEO analysis to see a summary and issues for this site.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* ROW 1: Current SEO health / Website Preview / SEO progress /
              Changes Since Last Analysis — up to 4 equal-width columns
              (fewer when a card doesn't apply). These stretch to match
              each other (default grid alignment) except Website Preview,
              whose own internal preview box keeps its fixed aspect ratio
              regardless — only its outer card border stretches, so nothing
              inside it is squeezed/cropped to force the row height. */}
          <div className={`grid grid-cols-1 gap-4 ${rowOneGridColsClass}`}>
            {/* Current SEO health: latest-attempt status + the categorical
                gauge/status (reused from the dashboard cards) + the same
                summary stats the old separate "SEO Health Summary" card
                showed, now compacted into one card. Spacing tightened
                (mt-3→mt-2, gap-4→gap-3, mt-4/pt-4→mt-3/pt-3) for the
                narrower 1/4-width column this card now sits in. */}
            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-900">Current SEO health</h2>
                <StatusBadge status={latestRun.status} />
              </div>

              <div className="mt-2 flex items-center gap-3">
                <SiteHealthGauge status={siteHealth.status} />
                <div className="min-w-0">
                  <HealthIndicator status={siteHealth.status} />
                  <p className="mt-1.5 text-xs text-zinc-500">
                    {latestCompletedRun
                      ? `Latest completed analysis: ${new Date(
                          latestCompletedRun.completed_at ?? latestCompletedRun.started_at,
                        ).toLocaleString()}`
                      : "No completed analysis yet."}
                  </p>
                </div>
              </div>

              {latestRun.status === "failed" &&
                (isBotProtectionFailureMessage(latestRun.error_message) ? (
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                    <p className="font-semibold">Analysis blocked</p>
                    <p className="mt-1">{latestRun.error_message}</p>
                  </div>
                ) : (
                  <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {latestRun.error_message ?? "The analysis failed."}
                  </p>
                ))}

              {isShowingPreservedReport && latestCompletedRun && (
                <p className="mt-3 text-xs text-zinc-500">
                  Showing results from the last successful analysis, on{" "}
                  {new Date(latestCompletedRun.started_at).toLocaleString()}.
                </p>
              )}

              {healthReport && (
                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-zinc-100 pt-3">
                  <SummaryStat label="Pages analyzed" value={healthReport.summary.pagesAnalyzed} />
                  <SummaryStat
                    label="Pages with issues"
                    value={healthReport.summary.pagesWithIssues}
                  />
                  <SummaryStat
                    label="High-priority issues"
                    value={healthReport.summary.highPriorityIssues}
                  />
                  <SummaryStat
                    label="Total opportunities"
                    value={healthReport.summary.totalIssues}
                  />
                </div>
              )}
            </div>

            <WebsitePreviewCard
              siteName={site.name}
              url={site.url}
              faviconUrl={site.favicon_url}
              embedStatus={embedCheck}
            />

            {/* SEO progress: only once there's an actual trend to show
                (2+ completed analyses) — one point per completed run,
                reusing the exact totals ("Total opportunities" /
                "High-priority issues") shown elsewhere in this report. No
                invented score, no AI: every value is a persisted
                crawl_issues count. Replaces Top Opportunities/Analyzed
                pages on the main page once there's history to show instead
                — see below. */}
            {showsProgressCard && (
              <div className="flex h-full flex-col rounded-lg border border-zinc-200 bg-white p-4">
                <h2 className="text-sm font-semibold text-zinc-900">SEO progress</h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Last {progressChartPoints.length} completed analyses.
                </p>
                <div className="mt-2 flex-1">
                  <SeoProgressChart points={progressChartPoints} />
                </div>
              </div>
            )}

            {changeReport && (
              <ChangesSinceLastAnalysisCard
                changeReport={changeReport}
                changeSummaryMessage={changeSummaryMessage}
              />
            )}
          </div>

          {/* ROW 2: Analysis history master-detail, full width — moved out
              of the narrow-column grid above. Owns its own two-panel
              layout/borders internally (list ~30% / detail ~70%), so no
              extra wrapping card is needed here. */}
          <AnalysisHistorySection
            siteId={site.id}
            runs={recentRuns ?? []}
            issueCounts={Object.fromEntries(issueCountByRunId)}
          />

          {/* Below both rows: detailed current-analysis content,
              only relevant while there's no Analysis History detail to
              rely on instead (0-1 completed analyses) — unchanged from
              before this layout pass, full width. */}
          {healthReport && healthReport.opportunities.length === 0 && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <p className="text-sm font-medium text-green-800">
                No critical SEO issues were detected in this crawl.
              </p>
              {healthReport.positiveSignals.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {healthReport.positiveSignals.map((signal) => (
                    <li key={signal} className="flex items-start gap-2 text-sm text-green-700">
                      <span aria-hidden="true">✓</span>
                      <span>{signal}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-green-700">
                This reflects only what this crawl measured ({healthReport.summary.pagesAnalyzed}{" "}
                page{healthReport.summary.pagesAnalyzed === 1 ? "" : "s"}) — not a guarantee of
                overall SEO performance.
              </p>
            </div>
          )}

          {!hasMultipleCompletedAnalyses && healthReport && healthReport.opportunities.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-zinc-900">Top Opportunities</h2>
              <OpportunitiesList opportunities={healthReport.opportunities} />
            </div>
          )}

          {!hasMultipleCompletedAnalyses && crawlPages && crawlPages.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">
                Analyzed pages ({crawlPages.length})
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500">Pages included in the latest analysis.</p>

              <div className="mt-2">
                <AnalyzedPagesTable pages={crawlPages} issues={crawlIssues ?? []} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
