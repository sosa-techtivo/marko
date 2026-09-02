import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUserAndOrganization } from "@/lib/organizations";
import { runSeoAnalysis } from "./actions";
import { buildSeoHealthReport } from "@/lib/reporting/seoHealthReport";
import { buildSeoChangeReport, type ChangedIssue } from "@/lib/reporting/seoChangeReport";
import { isBotProtectionFailureMessage } from "@/lib/crawler/botProtection";
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
    <li className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
      <PriorityBadge priority={issue.priority} />
      <CategoryBadge category={issue.category} />
      <span className="font-medium text-zinc-900">{issue.label}</span>
      <span className="max-w-xs truncate text-xs text-zinc-500">{issue.url}</span>
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
    .select("id, name, url")
    .eq("id", siteId)
    .eq("organization_id", organization.id)
    .maybeSingle();

  if (!site) {
    notFound();
  }

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
    .select("id, started_at")
    .eq("site_id", site.id)
    .eq("status", "completed")
    .order("started_at", { ascending: false })
    .limit(2);

  const latestCompletedRun = completedRuns?.[0] ?? null;
  const previousCompletedRun = completedRuns?.[1] ?? null;

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

  const pagesAnalyzed = crawlPages?.length ?? 0;
  const issuesFound = crawlIssues?.length ?? 0;
  const criticalIssues = crawlIssues?.filter((issue) => issue.severity === "critical").length ?? 0;

  const healthReport = latestCompletedRun
    ? buildSeoHealthReport(crawlPages ?? [], crawlIssues ?? [])
    : null;

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
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-900">
                  Latest analysis · {new Date(latestRun.started_at).toLocaleString()}
                </p>
                {latestRun.status === "completed" && (
                  <p className="mt-1 text-sm text-zinc-600">
                    {pagesAnalyzed} page{pagesAnalyzed === 1 ? "" : "s"} analyzed · {issuesFound}{" "}
                    issue{issuesFound === 1 ? "" : "s"} found
                    {criticalIssues > 0 ? ` (${criticalIssues} critical)` : ""}
                  </p>
                )}
              </div>
              <StatusBadge status={latestRun.status} />
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
          </div>

          {isShowingPreservedReport && latestCompletedRun && (
            <p className="text-xs text-zinc-500">
              Showing results from the last successful analysis, on{" "}
              {new Date(latestCompletedRun.started_at).toLocaleString()}.
            </p>
          )}

          {healthReport && (
            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-zinc-900">SEO Health Summary</h2>
              <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
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
            </div>
          )}

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

          {healthReport && healthReport.opportunities.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-zinc-900">Top Opportunities</h2>
              {healthReport.opportunities.map((opportunity) => (
                <div
                  key={opportunity.issueType}
                  className="rounded-lg border border-zinc-200 bg-white p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <PriorityBadge priority={opportunity.priority} />
                    <CategoryBadge category={opportunity.category} />
                    <h3 className="text-sm font-medium text-zinc-900">{opportunity.label}</h3>
                    <span className="text-xs text-zinc-500">
                      {opportunity.affectedPages.length} page
                      {opportunity.affectedPages.length === 1 ? "" : "s"} affected
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-zinc-600">{opportunity.whyItMatters}</p>
                  <p className="mt-1 text-sm text-zinc-800">
                    <span className="font-medium">Review: </span>
                    {opportunity.recommendedAction}
                  </p>
                  <ul className="mt-3 flex flex-col gap-1 border-t border-zinc-100 pt-3">
                    {opportunity.affectedPages.map((page) => (
                      <li key={page.url} className="text-xs text-zinc-500">
                        <span className="text-zinc-700">{page.url}</span> — {page.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

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
                    {new Date(changeReport.latestRun.startedAt).toLocaleString()}. Results reflect
                    only the pages measured by those two crawls.
                  </p>

                  <p className="mt-3 text-sm font-medium text-zinc-900">{changeSummaryMessage}</p>

                  <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
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
                    <p className="mt-3 text-xs text-zinc-500">
                      {changeReport.summary.excludedPreviousIssueCount} previously-flagged issue
                      {changeReport.summary.excludedPreviousIssueCount === 1 ? "" : "s"} on page
                      {changeReport.summary.excludedPreviousIssueCount === 1 ? "" : "s"} not
                      successfully re-analyzed in this crawl{" "}
                      {changeReport.summary.excludedPreviousIssueCount === 1 ? "is" : "are"}{" "}
                      excluded from this comparison — not counted as resolved.
                    </p>
                  )}

                  {changeReport.resolved.length > 0 && (
                    <div className="mt-4">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Resolved
                      </h3>
                      <ul className="mt-1 divide-y divide-zinc-100">
                        {changeReport.resolved.map((issue) => (
                          <ChangedIssueRow key={`${issue.issueType}-${issue.url}`} issue={issue} />
                        ))}
                      </ul>
                    </div>
                  )}

                  {changeReport.newIssues.length > 0 && (
                    <div className="mt-4">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        New
                      </h3>
                      <ul className="mt-1 divide-y divide-zinc-100">
                        {changeReport.newIssues.map((issue) => (
                          <ChangedIssueRow key={`${issue.issueType}-${issue.url}`} issue={issue} />
                        ))}
                      </ul>
                    </div>
                  )}

                  {changeReport.remaining.length > 0 && (
                    <div className="mt-4">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Remaining
                      </h3>
                      <ul className="mt-1 divide-y divide-zinc-100">
                        {changeReport.remaining.map((issue) => (
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
            <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
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
          )}
        </div>
      )}
    </div>
  );
}
