import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUserAndOrganization } from "@/lib/organizations";
import { runSeoAnalysis } from "./actions";
import { buildSeoHealthReport } from "@/lib/reporting/seoHealthReport";
import { buildSeoChangeReport, type ChangedIssue } from "@/lib/reporting/seoChangeReport";
import { isBotProtectionFailureMessage } from "@/lib/crawler/botProtection";
import { checkSiteEmbeddable } from "@/lib/preview/checkEmbeddable";
import { WebsitePreviewCard } from "@/components/WebsitePreviewCard";
import { SiteHealthGauge, HealthIndicator } from "@/components/SitesGrid";
import { deriveSiteHealthSummary } from "@/lib/reporting/siteHealthStatus";
import {
  CATEGORY_LABELS,
  ISSUE_TAXONOMY,
  PRIORITY_LABELS,
  type IssueCategory,
  type IssuePriority,
} from "@/lib/reporting/issueTaxonomy";

// Worst case is MAX_PAGES_PER_CRAWL sequential page fetches, each bounded by
// fetchPage's own per-page timeout; this gives Vercel's default 10s function
// timeout enough headroom to not cut a legitimate crawl short.
export const maxDuration = 60;

function issueLabel(issueType: string): string {
  return (ISSUE_TAXONOMY as Record<string, { label: string }>)[issueType]?.label ?? issueType;
}

function IssueBadge({
  issueType,
  severity,
  message,
}: {
  issueType: string;
  severity: string;
  message: string;
}) {
  const colors =
    severity === "critical"
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-amber-200 bg-amber-50 text-amber-800";

  return (
    <span
      title={message}
      className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${colors}`}
    >
      {issueLabel(issueType)}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: IssuePriority }) {
  const colors =
    priority === "high"
      ? "border-red-200 bg-red-50 text-red-700"
      : priority === "medium"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-zinc-300 bg-zinc-100 text-zinc-600";

  return (
    <span className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${colors}`}>
      {PRIORITY_LABELS[priority]} priority
    </span>
  );
}

function CategoryBadge({ category }: { category: IssueCategory }) {
  return (
    <span className="inline-block rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-500">
      {CATEGORY_LABELS[category]}
    </span>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-2xl font-semibold text-zinc-900">{value}</p>
      <p className="text-xs text-zinc-500">{label}</p>
    </div>
  );
}

function ChangedIssueRow({ issue }: { issue: ChangedIssue }) {
  return (
    <li className="flex flex-wrap items-center gap-1.5 py-1 text-xs">
      <PriorityBadge priority={issue.priority} />
      <CategoryBadge category={issue.category} />
      <span className="font-medium text-zinc-900">{issue.label}</span>
      <span className="max-w-xs truncate text-zinc-500">{issue.url}</span>
    </li>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors =
    status === "completed"
      ? "border-green-200 bg-green-50 text-green-700"
      : status === "failed"
        ? "border-red-200 bg-red-50 text-red-700"
        : "border-zinc-200 bg-zinc-50 text-zinc-600";

  const label = status === "completed" ? "Completed" : status === "failed" ? "Failed" : "Running";

  return (
    <span className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${colors}`}>
      {label}
    </span>
  );
}

/** Same three states as StatusBadge, plus a distinct "Blocked" state for a
 * failed run whose failure was a confirmed bot-protection block — used in
 * the compact Analysis history list, where that distinction matters more
 * than in the single latest-run banner above. */
function HistoryStatusBadge({ status, isBlocked }: { status: string; isBlocked: boolean }) {
  if (isBlocked) {
    return (
      <span className="inline-block rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
        Blocked
      </span>
    );
  }
  return <StatusBadge status={status} />;
}

type RecentRun = {
  id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  pages_crawled: number;
  error_message: string | null;
};

function HistoryRunRow({
  run,
  issueCount,
  isLatest,
}: {
  run: RecentRun;
  issueCount: number | null;
  isLatest: boolean;
}) {
  const isBlocked = run.status === "failed" && isBotProtectionFailureMessage(run.error_message);

  return (
    <li className="flex items-center justify-between gap-2 border-b border-zinc-100 py-2 text-xs last:border-b-0">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate font-medium text-zinc-900">
          {new Date(run.started_at).toLocaleString()}
          {isLatest && (
            <span className="inline-block shrink-0 rounded-md bg-primary-tint px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-primary-strong uppercase">
              Latest
            </span>
          )}
        </p>
        <p className="mt-0.5 text-zinc-500">
          {run.status === "completed"
            ? `${run.pages_crawled} page${run.pages_crawled === 1 ? "" : "s"}${
                issueCount !== null
                  ? ` · ${issueCount} opportunit${issueCount === 1 ? "y" : "ies"}`
                  : ""
              }`
            : isBlocked
              ? "Could not access site"
              : run.status === "failed"
                ? "Analysis failed"
                : "In progress"}
        </p>
      </div>
      <HistoryStatusBadge status={run.status} isBlocked={isBlocked} />
    </li>
  );
}

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
  const canEmbedPreviewPromise = checkSiteEmbeddable(site.url);

  const { data: latestRun } = await supabase
    .from("crawl_runs")
    .select("id, status, started_at, completed_at, pages_crawled, error_message")
    .eq("site_id", site.id)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Independent of `latestRun` above (which may be running/failed —
  // including a bot-protection-blocked attempt): the SEO report and the
  // Historical Changes comparison are both always sourced from the two most
  // recent *completed* runs, so a failed latest attempt never replaces or
  // hides the last genuinely successful report.
  const { data: completedRuns } = await supabase
    .from("crawl_runs")
    .select("id, started_at, completed_at")
    .eq("site_id", site.id)
    .eq("status", "completed")
    .order("started_at", { ascending: false })
    .limit(2);

  const latestCompletedRun = completedRuns?.[0] ?? null;
  const previousCompletedRun = completedRuns?.[1] ?? null;

  // A separate, additive query (any status, not just completed) purely for
  // the "Analysis history" list — doesn't affect `latestRun`/`completedRuns`
  // above or anything derived from them (health report, change report).
  const HISTORY_RUN_LIMIT = 6;
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

  const issuesByPageId = new Map<string, NonNullable<typeof crawlIssues>>();
  for (const issue of crawlIssues ?? []) {
    const list = issuesByPageId.get(issue.crawl_page_id) ?? [];
    list.push(issue);
    issuesByPageId.set(issue.crawl_page_id, list);
  }

  const healthReport = latestCompletedRun
    ? buildSeoHealthReport(crawlPages ?? [], crawlIssues ?? [])
    : null;

  // Same categorical status/logic as the dashboard cards (SitesGrid) — no
  // separate scoring is introduced here.
  const siteHealth = deriveSiteHealthSummary(latestCompletedRun ? (crawlIssues ?? []) : null);

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

  const canEmbedPreview = await canEmbedPreviewPromise;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/dashboard" className="text-sm text-zinc-500 hover:text-primary-strong">
        ← Back to sites
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">{site.name}</h1>
          <p className="text-sm text-zinc-500">{site.url}</p>
        </div>
        <form action={runSeoAnalysis}>
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
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[13fr_7fr] lg:gap-6">
            {/* Left column (~65%): website info, Current SEO health, Top Opportunities */}
            <div className="flex min-w-0 flex-col gap-4">
              {/* Current SEO health: latest-attempt status + the categorical
                  gauge/status (reused from the dashboard cards) + the same
                  summary stats the old separate "SEO Health Summary" card
                  showed, now compacted into one card. */}
              <div className="rounded-lg border border-zinc-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-zinc-900">Current SEO health</h2>
                  <StatusBadge status={latestRun.status} />
                </div>

                <div className="mt-3 flex items-center gap-4">
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
                  <div className="mt-4 grid grid-cols-2 gap-4 border-t border-zinc-100 pt-4 sm:grid-cols-4">
                    <SummaryStat
                      label="Pages analyzed"
                      value={healthReport.summary.pagesAnalyzed}
                    />
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
                    This reflects only what this crawl measured (
                    {healthReport.summary.pagesAnalyzed} page
                    {healthReport.summary.pagesAnalyzed === 1 ? "" : "s"}) — not a guarantee of
                    overall SEO performance.
                  </p>
                </div>
              )}

              {/* Top Opportunities: the main content of this column. Same
                  opportunity data/logic as before — only the presentation is
                  more compact, and a long affected-pages list collapses
                  behind a native <details> toggle instead of always
                  rendering expanded. */}
              {healthReport && healthReport.opportunities.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h2 className="text-sm font-semibold text-zinc-900">Top Opportunities</h2>
                  {healthReport.opportunities.map((opportunity) => {
                    const affectedPages = opportunity.affectedPages;
                    const pageList = (
                      <ul className="flex flex-col gap-1">
                        {affectedPages.map((page) => (
                          <li key={page.url} className="text-xs text-zinc-500">
                            <span className="text-zinc-700">{page.url}</span> — {page.message}
                          </li>
                        ))}
                      </ul>
                    );

                    return (
                      <div
                        key={opportunity.issueType}
                        className="rounded-lg border border-zinc-200 bg-white p-3"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <PriorityBadge priority={opportunity.priority} />
                          <CategoryBadge category={opportunity.category} />
                          <h3 className="text-sm font-medium text-zinc-900">{opportunity.label}</h3>
                          <span className="text-xs text-zinc-500">
                            {affectedPages.length} page{affectedPages.length === 1 ? "" : "s"}{" "}
                            affected
                          </span>
                        </div>
                        <p className="mt-1.5 text-xs text-zinc-600">{opportunity.whyItMatters}</p>
                        <p className="mt-1 text-xs text-zinc-800">
                          <span className="font-medium">Review: </span>
                          {opportunity.recommendedAction}
                        </p>
                        {affectedPages.length > 3 ? (
                          <details className="mt-2 border-t border-zinc-100 pt-2">
                            <summary className="cursor-pointer text-xs font-medium text-primary-strong">
                              {affectedPages.length} affected pages
                            </summary>
                            <div className="mt-2">{pageList}</div>
                          </details>
                        ) : (
                          <div className="mt-2 border-t border-zinc-100 pt-2">{pageList}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right column (~35%): Website Preview (unchanged), then
                Analysis history below it */}
            <div className="flex flex-col gap-4">
              <WebsitePreviewCard
                siteName={site.name}
                url={site.url}
                faviconUrl={site.favicon_url}
                canEmbed={canEmbedPreview}
              />

              <div className="rounded-lg border border-zinc-200 bg-white p-4">
                <h2 className="text-sm font-semibold text-zinc-900">Analysis history</h2>
                {recentRuns && recentRuns.length > 0 ? (
                  <ul className="mt-2 flex flex-col">
                    {recentRuns.map((run, index) => (
                      <HistoryRunRow
                        key={run.id}
                        run={run}
                        isLatest={index === 0}
                        issueCount={
                          run.status === "completed"
                            ? (issueCountByRunId.get(run.id) ?? 0)
                            : null
                        }
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-zinc-500">No previous analyses yet.</p>
                )}
              </div>
            </div>
          </div>

          {changeReport && (
            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-zinc-900">Changes Since Last Analysis</h2>

              {changeReport.status === "no-previous-run" ? (
                <p className="mt-2 text-sm text-zinc-600">
                  No previous analysis is available for comparison yet. This is the first
                  completed crawl for this site.
                </p>
              ) : (
                <>
                  <p className="mt-1 text-xs text-zinc-500">
                    Comparing {new Date(changeReport.previousRun.startedAt).toLocaleString()} to{" "}
                    {new Date(changeReport.latestRun.startedAt).toLocaleString()}.
                  </p>

                  <p className="mt-2 text-xs font-medium text-zinc-900">{changeSummaryMessage}</p>

                  <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <SummaryStat label="Resolved" value={changeReport.summary.resolvedCount} />
                    <SummaryStat label="New" value={changeReport.summary.newCount} />
                    <SummaryStat label="Remaining" value={changeReport.summary.remainingCount} />
                    <div className="flex flex-col gap-1">
                      <p className="text-2xl font-semibold text-zinc-900">
                        {changeReport.summary.previousPagesWithIssues} →{" "}
                        {changeReport.summary.currentPagesWithIssues}
                      </p>
                      <p className="text-xs text-zinc-500">Pages with issues</p>
                    </div>
                  </div>

                  {changeReport.summary.excludedPreviousIssueCount > 0 && (
                    <p className="mt-2 text-xs text-zinc-500">
                      {changeReport.summary.excludedPreviousIssueCount} previously-flagged issue
                      {changeReport.summary.excludedPreviousIssueCount === 1 ? "" : "s"} on page
                      {changeReport.summary.excludedPreviousIssueCount === 1 ? "" : "s"} not
                      successfully re-analyzed in this crawl{" "}
                      {changeReport.summary.excludedPreviousIssueCount === 1 ? "is" : "are"}{" "}
                      excluded from this comparison — not counted as resolved.
                    </p>
                  )}

                  {/* Only New and Resolved are listed in detail — Remaining
                      findings are already covered by Top Opportunities, so
                      repeating them here would just duplicate that list. */}
                  {changeReport.resolved.length > 0 && (
                    <div className="mt-3 border-t border-zinc-100 pt-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Resolved
                      </h3>
                      <ul className="divide-y divide-zinc-100">
                        {changeReport.resolved.map((issue) => (
                          <ChangedIssueRow key={`${issue.issueType}-${issue.url}`} issue={issue} />
                        ))}
                      </ul>
                    </div>
                  )}

                  {changeReport.newIssues.length > 0 && (
                    <div className="mt-3 border-t border-zinc-100 pt-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        New
                      </h3>
                      <ul className="divide-y divide-zinc-100">
                        {changeReport.newIssues.map((issue) => (
                          <ChangedIssueRow key={`${issue.issueType}-${issue.url}`} issue={issue} />
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {crawlPages && crawlPages.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">
                Analyzed pages ({crawlPages.length})
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500">Pages included in the latest analysis.</p>

              <div className="mt-2 overflow-x-auto rounded-lg border border-zinc-200 bg-white">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-xs text-zinc-500">
                      <th className="px-4 py-2 font-medium">URL</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Title</th>
                      <th className="px-4 py-2 font-medium">Issues</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200">
                    {crawlPages.map((page) => (
                      <tr key={page.id}>
                        <td className="max-w-xs truncate px-4 py-3 text-zinc-900">{page.url}</td>
                        <td className="px-4 py-3 text-zinc-600">{page.http_status ?? "—"}</td>
                        <td className="max-w-xs truncate px-4 py-3 text-zinc-600">
                          {page.title ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {(issuesByPageId.get(page.id) ?? []).map((issue) => (
                              <IssueBadge
                                key={issue.id}
                                issueType={issue.issue_type}
                                severity={issue.severity}
                                message={issue.message}
                              />
                            ))}
                            {(issuesByPageId.get(page.id) ?? []).length === 0 && (
                              <span className="text-xs text-zinc-400">None</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
