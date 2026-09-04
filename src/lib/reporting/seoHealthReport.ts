import type { CrawlIssueType } from "@/lib/crawler/analyze";
import {
  ISSUE_TAXONOMY,
  type IssueCategory,
  type IssuePriority,
} from "./issueTaxonomy";

/**
 * Turns a completed crawl's raw pages + issues into the SEO Health Summary
 * and Top Opportunities the site detail page renders. Pure, deterministic,
 * derived entirely from already-persisted crawl_pages/crawl_issues rows —
 * no AI, no new data, no scoring.
 */

export type CrawlPageRow = {
  id: string;
  url: string;
  http_status: number | null;
  title: string | null;
  meta_description: string | null;
  h1: string | null;
  canonical_url: string | null;
  is_indexable: boolean;
  /** The URL this page's fetch actually landed on after following any
   * redirects (see redirect transparency, crawl_pages.final_url) — used
   * only to identify the narrow "seed entry redirect" exclusion below;
   * not otherwise part of this report. */
  final_url?: string | null;
  /** Number of redirect hops to reach `final_url` (0 if none) — see above. */
  redirect_count?: number;
};

export type CrawlIssueRow = {
  id: string;
  crawl_page_id: string;
  issue_type: string;
  message: string;
};

export type SeoOpportunity = {
  issueType: CrawlIssueType;
  category: IssueCategory;
  priority: IssuePriority;
  label: string;
  whyItMatters: string;
  recommendedAction: string;
  affectedPages: { url: string; message: string }[];
};

export type SeoHealthReport = {
  summary: {
    pagesAnalyzed: number;
    pagesWithIssues: number;
    highPriorityIssues: number;
    totalIssues: number;
    /** How many raw crawl_issues rows were excluded from every count/list
     * above as a seed-entry-redirect artifact (see
     * isSeedEntryRedirectArtifact) — never itself added back into a
     * client-facing total, but surfaced so a Technical Appendix–style
     * consumer can note that raw evidence exists without inflating the
     * headline numbers. Zero whenever `registeredUrl` isn't passed. */
    excludedSeedArtifactCount: number;
  };
  opportunities: SeoOpportunity[];
  /** Only meaningful/non-empty when there are zero issues; see buildSeoHealthReport. */
  positiveSignals: string[];
};

const PRIORITY_ORDER: Record<IssuePriority, number> = { high: 0, medium: 1, low: 2 };

function isKnownIssueType(type: string): type is CrawlIssueType {
  return Object.prototype.hasOwnProperty.call(ISSUE_TAXONOMY, type);
}

function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Whether `issue` exists *only* because the crawl's seed page was fetched
 * at the site's registered URL and that URL happens to redirect elsewhere
 * — not a real, ongoing SEO problem with the effective website, just an
 * artifact of which entry-point URL was registered. Narrowly scoped:
 *
 *  - Only ever applies to the seed page itself (`page.url === registeredUrl`)
 *    — a redirect discovered on any other, non-seed page is a real,
 *    genuine finding and is never excluded here.
 *  - `redirected` on the seed: excluded outright once the seed page is
 *    confirmed to have actually redirected (`redirect_count > 0`).
 *  - `invalid_canonical` on the seed: excluded *only* when the page's own
 *    canonical tag correctly, exactly points at the host the seed
 *    actually resolved to (`final_url`) — i.e. the "different domain"
 *    this finding names is precisely the pre-redirect entry host versus
 *    the real, effective host, and nothing else. A canonical that's
 *    empty, unparsable, or points at some other unrelated domain is never
 *    excluded — it remains a genuine finding regardless of the entry
 *    redirect.
 *
 * Exported (not local to this module) so `buildSeoChangeReport` can apply
 * the exact same exclusion to its own Resolved/New/Remaining comparison —
 * two independent re-implementations of this rule previously drifted,
 * producing a client-visible total mismatch between the SEO Health Summary
 * and the historical comparison (35 vs. 37) for the same analysis. Takes
 * minimal structural types rather than CrawlIssueRow/CrawlPageRow directly
 * so callers with their own, differently-shaped row types (e.g.
 * ComparisonIssueRow/ComparisonPageRow) can pass their rows as-is.
 */
export function isSeedEntryRedirectArtifact(
  issue: { issue_type: string },
  page: { url: string; redirect_count?: number; final_url?: string | null; canonical_url?: string | null } | undefined,
  registeredUrl: string | undefined,
): boolean {
  if (!page || !registeredUrl) return false;
  if (page.url !== registeredUrl) return false;
  if (!page.redirect_count || !page.final_url) return false;

  if (issue.issue_type === "redirected") return true;

  if (issue.issue_type === "invalid_canonical") {
    if (!page.canonical_url) return false;
    const canonicalHost = extractHostname(page.canonical_url);
    const effectiveHost = extractHostname(page.final_url);
    return canonicalHost !== null && canonicalHost === effectiveHost;
  }

  return false;
}

function buildPositiveSignals(pages: CrawlPageRow[]): string[] {
  if (pages.length === 0) return [];

  const signals: string[] = [];
  const count = pages.length;
  const plural = count === 1 ? "page" : "pages";

  if (pages.every((p) => p.http_status !== null && p.http_status >= 200 && p.http_status < 300)) {
    signals.push(`All ${count} analyzed ${plural} returned a successful response.`);
  }
  if (pages.every((p) => !!p.title)) {
    signals.push("Every analyzed page has a title tag.");
  }
  if (pages.every((p) => !!p.meta_description)) {
    signals.push("Every analyzed page has a meta description.");
  }
  if (pages.every((p) => !!p.h1)) {
    signals.push("Every analyzed page has an H1 heading.");
  }
  if (pages.every((p) => p.is_indexable)) {
    signals.push(
      count === 1
        ? "The analyzed page is not blocked from indexing."
        : "None of the analyzed pages are blocked from indexing.",
    );
  }
  if (pages.every((p) => !!p.canonical_url)) {
    signals.push("Every analyzed page has a canonical tag.");
  }

  return signals;
}

/**
 * `registeredUrl` — the site's registered URL (`sites.url`) — is optional
 * and purely additive: passing it enables the narrow seed-entry-redirect
 * exclusion (see `isSeedEntryRedirectArtifact`); omitting it (or passing
 * page rows without `final_url`/`redirect_count`) reproduces this
 * function's exact previous behavior, so every existing/omitted caller is
 * unaffected.
 */
export function buildSeoHealthReport(
  pages: CrawlPageRow[],
  issues: CrawlIssueRow[],
  registeredUrl?: string,
): SeoHealthReport {
  const pageById = new Map(pages.map((p) => [p.id, p]));

  // Excluded here, before any counting/grouping below, so the summary
  // stats, the opportunities list, and the positive-signals fallback all
  // consistently reflect the same "main report" view. This never touches
  // `pages` (crawl coverage/"Pages analyzed" is unaffected) or the raw
  // `issues` a caller already has independently for per-page detail —
  // only which issues this function's own aggregation counts.
  const countedIssues = issues.filter(
    (issue) => !isSeedEntryRedirectArtifact(issue, pageById.get(issue.crawl_page_id), registeredUrl),
  );

  const byType = new Map<CrawlIssueType, SeoOpportunity>();
  for (const issue of countedIssues) {
    if (!isKnownIssueType(issue.issue_type)) continue;
    const taxonomy = ISSUE_TAXONOMY[issue.issue_type];

    let opportunity = byType.get(issue.issue_type);
    if (!opportunity) {
      opportunity = {
        issueType: issue.issue_type,
        category: taxonomy.category,
        priority: taxonomy.priority,
        label: taxonomy.label,
        whyItMatters: taxonomy.whyItMatters,
        recommendedAction: taxonomy.recommendedAction,
        affectedPages: [],
      };
      byType.set(issue.issue_type, opportunity);
    }
    opportunity.affectedPages.push({
      url: pageById.get(issue.crawl_page_id)?.url ?? "Unknown page",
      message: issue.message,
    });
  }

  const opportunities = Array.from(byType.values()).sort((a, b) => {
    const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return b.affectedPages.length - a.affectedPages.length;
  });

  const pagesWithIssues = new Set(countedIssues.map((i) => i.crawl_page_id)).size;
  const highPriorityIssues = countedIssues.filter(
    (i) => isKnownIssueType(i.issue_type) && ISSUE_TAXONOMY[i.issue_type].priority === "high",
  ).length;

  return {
    summary: {
      pagesAnalyzed: pages.length,
      pagesWithIssues,
      highPriorityIssues,
      totalIssues: countedIssues.length,
      excludedSeedArtifactCount: issues.length - countedIssues.length,
    },
    opportunities,
    positiveSignals: countedIssues.length === 0 ? buildPositiveSignals(pages) : [],
  };
}
