import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUserAndOrganization } from "@/lib/organizations";
import { isBotProtectionFailureMessage } from "@/lib/crawler/botProtection";
import { SitesGrid, type SiteCardData } from "@/components/SitesGrid";
import { deriveSiteHealthSummary } from "@/lib/reporting/siteHealthStatus";
import { AddSiteButton } from "@/components/AddSiteButton";

async function createOrganization(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    redirect("/dashboard?error=missing-org-name");
  }

  const { error } = await supabase.rpc("create_organization", {
    org_name: name,
  });

  if (error) {
    console.error("[createOrganization] create_organization RPC failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    redirect("/dashboard?error=org-save-failed");
  }

  redirect("/dashboard");
}

/** Small, dependency-free relative-time label; falls back to a plain date past 30 days. */
function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; addSite?: string }>;
}) {
  const { error, addSite } = await searchParams;
  const { organization } = await requireUserAndOrganization();

  if (!organization) {
    return (
      <div className="mx-auto w-full max-w-md">
        <h1 className="text-xl font-semibold text-zinc-900">
          Create your organization
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Set up your client/business account before adding a site.
        </p>
        <form action={createOrganization} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="name" className="text-sm font-medium text-zinc-700">
              Organization name
            </label>
            <input
              id="name"
              name="name"
              required
              placeholder="Acme Inc."
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
          </div>
          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error === "missing-org-name"
                ? "Please provide an organization name."
                : "Something went wrong creating the organization. Please try again."}
            </p>
          )}
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Create organization
          </button>
        </form>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: sites } = await supabase
    .from("sites")
    .select("id, name, url, favicon_url, archived_at, created_at")
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: false });

  const siteIds = (sites ?? []).map((site) => site.id);

  // One query covers both "latest attempt" (any status — used to detect a
  // blocked latest attempt) and "latest completed run" (used for the SEO
  // metrics): fetch every run for these sites ordered newest-first, then
  // for each site keep the first run seen (= latest attempt) and the first
  // one seen with status 'completed' (= latest completed run). No N+1.
  const latestAttemptBySiteId = new Map<
    string,
    { id: string; status: string; completed_at: string | null; started_at: string; error_message: string | null }
  >();
  const latestCompletedRunBySiteId = new Map<
    string,
    { id: string; completed_at: string | null; pages_crawled: number }
  >();

  if (siteIds.length > 0) {
    const { data: runs } = await supabase
      .from("crawl_runs")
      .select("id, site_id, status, started_at, completed_at, pages_crawled, error_message")
      .eq("organization_id", organization.id)
      .in("site_id", siteIds)
      .order("started_at", { ascending: false });

    for (const run of runs ?? []) {
      if (!latestAttemptBySiteId.has(run.site_id)) {
        latestAttemptBySiteId.set(run.site_id, run);
      }
      if (run.status === "completed" && !latestCompletedRunBySiteId.has(run.site_id)) {
        latestCompletedRunBySiteId.set(run.site_id, run);
      }
    }
  }

  // Issues for every one of those latest completed runs, in one more query,
  // then grouped in memory by crawl_run_id.
  const latestRunIds = Array.from(latestCompletedRunBySiteId.values()).map((run) => run.id);
  const issuesByRunId = new Map<string, { issue_type: string }[]>();

  if (latestRunIds.length > 0) {
    const { data: issues } = await supabase
      .from("crawl_issues")
      .select("crawl_run_id, issue_type")
      .in("crawl_run_id", latestRunIds);

    for (const issue of issues ?? []) {
      const list = issuesByRunId.get(issue.crawl_run_id) ?? [];
      list.push(issue);
      issuesByRunId.set(issue.crawl_run_id, list);
    }
  }

  // Pure view-model derivation — every value here comes straight from the
  // existing queries/logic above (deriveSiteHealthSummary,
  // isBotProtectionFailureMessage); nothing is reinvented, just packaged
  // as plain serializable data for the client-side search/filter grid.
  const siteCards: SiteCardData[] = (sites ?? []).map((site) => {
    const latestAttempt = latestAttemptBySiteId.get(site.id) ?? null;
    const latestCompletedRun = latestCompletedRunBySiteId.get(site.id) ?? null;
    const isBlocked =
      latestAttempt?.status === "failed" &&
      isBotProtectionFailureMessage(latestAttempt.error_message);
    const health = deriveSiteHealthSummary(
      latestCompletedRun ? (issuesByRunId.get(latestCompletedRun.id) ?? []) : null,
    );

    return {
      id: site.id,
      name: site.name,
      url: site.url,
      faviconUrl: site.favicon_url,
      isBlocked,
      isArchived: site.archived_at !== null,
      status: health.status,
      filterStatus: isBlocked ? "analysis_blocked" : health.status,
      pagesAnalyzed: latestCompletedRun?.pages_crawled ?? 0,
      totalOpportunities: health.totalIssues,
      highPriorityIssues: health.highPriorityIssues,
      footerText: isBlocked
        ? `Blocked ${formatRelativeTime(latestAttempt!.completed_at ?? latestAttempt!.started_at)}`
        : latestCompletedRun?.completed_at
          ? `Last analysis ${formatRelativeTime(latestCompletedRun.completed_at)}`
          : "No analysis yet",
      hasHistoricalReport: latestCompletedRun !== null,
      historicalLabel: latestCompletedRun
        ? `Last successful: ${latestCompletedRun.completed_at ? formatRelativeTime(latestCompletedRun.completed_at) : "unknown"}`
        : null,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Sites</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Monitor and improve your SEO performance.
          </p>
        </div>
        <AddSiteButton
          initialOpen={addSite === "1"}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        />
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error === "site-not-found"
            ? "That site could not be found."
            : "Something went wrong. Please try again."}
        </p>
      )}

      {siteCards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center">
          <p className="text-sm font-medium text-zinc-900">No sites yet</p>
          <p className="mt-1 text-sm text-zinc-500">
            Add your first website to get started with MARKO.
          </p>
          <AddSiteButton className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2" />
        </div>
      ) : (
        <SitesGrid sites={siteCards} />
      )}
    </div>
  );
}
