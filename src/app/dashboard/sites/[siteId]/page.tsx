import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUserAndOrganization } from "@/lib/organizations";
import { runSeoAnalysis } from "./actions";

// Worst case is MAX_PAGES_PER_CRAWL sequential page fetches, each bounded by
// fetchPage's own per-page timeout; this gives Vercel's default 10s function
// timeout enough headroom to not cut a legitimate crawl short.
export const maxDuration = 60;

const ISSUE_LABELS: Record<string, string> = {
  http_error: "HTTP error",
  missing_title: "Missing title",
  missing_meta_description: "Missing meta description",
  missing_h1: "Missing H1",
  non_indexable: "Non-indexable",
  invalid_canonical: "Invalid canonical",
};

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
      {ISSUE_LABELS[issueType] ?? issueType}
    </span>
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

  const { data: crawlPages } = latestRun
    ? await supabase
        .from("crawl_pages")
        .select("id, url, http_status, title, is_indexable")
        .eq("crawl_run_id", latestRun.id)
        .order("created_at", { ascending: true })
    : { data: null };

  const { data: crawlIssues } = latestRun
    ? await supabase
        .from("crawl_issues")
        .select("id, crawl_page_id, issue_type, severity, message")
        .eq("crawl_run_id", latestRun.id)
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

  return (
    <div className="flex flex-col gap-6">
      <Link href="/dashboard" className="text-sm text-zinc-500 hover:text-zinc-700">
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
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
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

            {latestRun.status === "failed" && (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {latestRun.error_message ?? "The analysis failed."}
              </p>
            )}
          </div>

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
