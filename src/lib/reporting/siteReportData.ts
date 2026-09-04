import { buildSeoHealthReport, type CrawlIssueRow, type CrawlPageRow, type SeoHealthReport } from "./seoHealthReport";
import {
  buildSeoChangeReport,
  type ComparisonIssueRow,
  type ComparisonPageRow,
  type SeoChangeReport,
} from "./seoChangeReport";
import { buildMarkoInsights, type MarkoInsight } from "./markoInsights";
import { buildExecutiveNarrative, buildProgressNarrative } from "./narrative";
import {
  deriveSiteHealthSummary,
  deriveSiteHealthSummaryFromCounts,
  type SiteHealthSummary,
} from "./siteHealthStatus";
import { describeRegisteredUrlRedirect, resolveEffectiveSiteUrl } from "@/lib/sites/effectiveUrl";
import type { PerformanceSnapshot } from "@/lib/googleSearchConsole/snapshot";
import type { SiteSnapshotResult } from "@/lib/googleSearchConsole/siteSnapshot";

/**
 * Pure assembly of one site's full report — the exact same domain
 * computations the live site detail page uses (`buildSeoHealthReport`,
 * `buildSeoChangeReport`, `buildMarkoInsights`, `deriveSiteHealthSummary*`,
 * the registered/effective URL helpers), applied to already-fetched rows.
 *
 * This is the single place both the site detail page's data needs and the
 * downloadable PDF's data needs are computed from — "one source of truth"
 * per CLAUDE.md and the PDF feature's own explicit requirement. Neither
 * consumer re-derives totals independently; both call this function (or,
 * for the live page, the same underlying builder calls this function also
 * makes) over the same persisted rows.
 *
 * No I/O here — every row this needs (crawl_pages/crawl_issues for the
 * latest and previous completed runs, and an already-fetched Search
 * Console snapshot if any) is supplied by the caller, which is free to
 * fetch it however its own context requires (Server Component props vs.
 * a Route Handler's own queries) without this function knowing or caring.
 *
 * Deliberately does NOT build a multi-analysis trend: an older
 * completed run's total can only be counted from its raw crawl_issues
 * rows, which skips buildSeoHealthReport's seed-entry-redirect exclusion
 * the latest run's total gets — that inconsistency previously produced
 * misleading client-facing sequences (e.g. a run appearing to have zero
 * findings between two normal ones). The client-facing report instead
 * only ever compares exactly two runs — latest vs. previous — via
 * `changeReport`, which applies that exclusion consistently on both
 * sides. See progressNarrative below and SeoReportDocument's SEO
 * Progress section.
 */

/** The subset of a Search Console snapshot worth showing in a client-
 * facing report — omitted entirely by the caller (not included as this
 * type) whenever Search Console is disconnected, unmatched, erroring, or
 * has no data yet; see buildSearchConsoleReportSection below. */
export type SearchConsoleReportSection = {
  snapshot: PerformanceSnapshot;
};

export type SiteReportSite = {
  name: string;
  slug: string;
  /** The Registered URL — exactly what the user entered (`sites.url`). */
  registeredUrl: string;
  /** The Effective URL — `sites.effective_url` when known, else the
   * registered URL unchanged (see resolveEffectiveSiteUrl). */
  effectiveUrl: string;
  /** Small, factual "X redirects to Y" note, or null when there's nothing
   * meaningfully different to say (see describeRegisteredUrlRedirect). */
  registeredUrlRedirectNote: string | null;
};

export type SiteReportData = {
  site: SiteReportSite;
  generatedAt: string;
  latestRun: {
    id: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    errorMessage: string | null;
  } | null;
  latestCompletedRun: { id: string; startedAt: string; completedAt: string | null } | null;
  /** True when the absolute latest attempt (which may have failed, or be
   * a different run than the latest *completed* one) differs from the
   * completed run this report is actually built from — the same "showing
   * a preserved report" fact the live page surfaces. */
  isShowingPreservedReport: boolean;
  health: SeoHealthReport | null;
  siteHealthStatus: SiteHealthSummary;
  /** "What is the current SEO situation?" — a short, deterministic
   * narrative derived only from `health` (see narrative.ts). Null exactly
   * when `health` is null (no completed analysis to describe). */
  executiveNarrative: string | null;
  insights: MarkoInsight[];
  changeReport: SeoChangeReport | null;
  /** "Is SEO improving over time?" — a short, deterministic narrative
   * derived only from `changeReport` (see narrative.ts). Null whenever
   * `changeReport` isn't `{status: "compared"}` (no completed analysis, or
   * no previous one to compare against). */
  progressNarrative: string | null;
  /** Null whenever Search Console isn't connected, isn't matched to a
   * property, errored, or simply has no data yet — never populated with
   * an error state a client-facing report shouldn't alarm the reader
   * with. See buildSearchConsoleReportSection. */
  searchConsole: SearchConsoleReportSection | null;
};

export type SiteReportRawInput = {
  site: {
    name: string;
    slug: string;
    url: string;
    effective_url: string | null;
  };
  now?: Date;
  latestRun: {
    id: string;
    status: string;
    started_at: string;
    completed_at: string | null;
    error_message: string | null;
  } | null;
  /** Every *completed* run for this site, newest-first — index 0 is the
   * latest completed run, index 1 the previous one. Only these two are
   * ever used (see the module doc comment above for why this
   * deliberately doesn't reach further back for a multi-run trend). */
  completedRuns: { id: string; started_at: string; completed_at: string | null }[];
  /** crawl_pages for the latest completed run only. */
  latestCrawlPages: CrawlPageRow[];
  /** crawl_issues for the latest completed run only. */
  latestCrawlIssues: CrawlIssueRow[];
  /** crawl_pages for [latest, previous] completed runs combined — the
   * change report's own comparison input. */
  comparisonPages: ComparisonPageRow[];
  /** crawl_issues for [latest, previous] completed runs combined. */
  comparisonIssues: ComparisonIssueRow[];
  /** Already-fetched (or intentionally not fetched, e.g. GSC not
   * connected) Search Console snapshot result — see
   * buildSearchConsoleReportSection for how this becomes (or doesn't
   * become) `searchConsole` in the output. */
  searchConsoleSnapshot: SiteSnapshotResult | null;
};

/** The "prefer omitting rather than presenting an alarming error"
 * requirement, applied narrowly: a client-facing report only ever
 * includes Search Console figures when there's real, present data behind
 * them — never a "disconnected"/"needs reauth"/"error" state, and never a
 * connected-but-empty period. */
function buildSearchConsoleReportSection(
  result: SiteSnapshotResult | null,
): SearchConsoleReportSection | null {
  if (!result || result.status !== "ok") return null;
  if (!result.snapshot.current.hasData) return null;
  return { snapshot: result.snapshot };
}

export function assembleSiteReportData(input: SiteReportRawInput): SiteReportData {
  const generatedAt = (input.now ?? new Date()).toISOString();

  const site: SiteReportSite = {
    name: input.site.name,
    slug: input.site.slug,
    registeredUrl: input.site.url,
    effectiveUrl: resolveEffectiveSiteUrl({ url: input.site.url, effective_url: input.site.effective_url }),
    registeredUrlRedirectNote: describeRegisteredUrlRedirect(input.site.url, input.site.effective_url),
  };

  const latestCompletedRun = input.completedRuns[0] ?? null;
  const previousCompletedRun = input.completedRuns[1] ?? null;

  const health = latestCompletedRun
    ? buildSeoHealthReport(input.latestCrawlPages, input.latestCrawlIssues, input.site.url)
    : null;

  const siteHealthStatus = health
    ? deriveSiteHealthSummaryFromCounts(health.summary.totalIssues, health.summary.highPriorityIssues)
    : deriveSiteHealthSummary(null);

  const changeReport = latestCompletedRun
    ? buildSeoChangeReport({
        latestRun: { id: latestCompletedRun.id, startedAt: latestCompletedRun.started_at },
        previousRun: previousCompletedRun
          ? { id: previousCompletedRun.id, startedAt: previousCompletedRun.started_at }
          : null,
        pages: input.comparisonPages,
        issues: input.comparisonIssues,
        registeredUrl: input.site.url,
      })
    : null;

  const insights = health && changeReport ? buildMarkoInsights(health, changeReport) : [];

  const isShowingPreservedReport = Boolean(
    latestCompletedRun && input.latestRun && input.latestRun.id !== latestCompletedRun.id,
  );

  return {
    site,
    generatedAt,
    latestRun: input.latestRun
      ? {
          id: input.latestRun.id,
          status: input.latestRun.status,
          startedAt: input.latestRun.started_at,
          completedAt: input.latestRun.completed_at,
          errorMessage: input.latestRun.error_message,
        }
      : null,
    latestCompletedRun: latestCompletedRun
      ? {
          id: latestCompletedRun.id,
          startedAt: latestCompletedRun.started_at,
          completedAt: latestCompletedRun.completed_at,
        }
      : null,
    isShowingPreservedReport,
    health,
    siteHealthStatus,
    executiveNarrative: buildExecutiveNarrative(health, site.name),
    insights,
    changeReport,
    progressNarrative: changeReport ? buildProgressNarrative(changeReport) : null,
    searchConsole: buildSearchConsoleReportSection(input.searchConsoleSnapshot),
  };
}
