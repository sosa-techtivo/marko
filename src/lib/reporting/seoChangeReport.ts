import type { CrawlIssueType } from "@/lib/crawler/analyze";
import { ISSUE_TAXONOMY, type IssueCategory, type IssuePriority } from "./issueTaxonomy";
import { isSeedEntryRedirectArtifact } from "./seoHealthReport";

/**
 * Compares the latest completed crawl to the immediately previous completed
 * crawl for the same site, classifying each (page URL, issue_type) pair as
 * Resolved / New / Remaining. Pure, deterministic, derived entirely from
 * already-persisted crawl_pages/crawl_issues rows — no AI, no new data.
 *
 * The crawler analyzes at most MAX_PAGES_PER_CRAWL pages per run and which
 * pages get crawled can change between runs (link discovery on the start
 * page isn't guaranteed stable, and the page cap itself has grown over
 * time — see runCrawl.ts), so a URL only ever participates in Resolved /
 * New / Remaining comparison at all if it was *successfully analyzed in
 * both* the previous and the latest run ("comparable" below; success means
 * present in that run's pages, fetched with a 2xx status, no fetch error).
 * Two asymmetric cases fall out of that:
 *
 *  - A URL successfully analyzed in the latest run but not comparable
 *    (never crawled before, or crawled before but not successfully) is a
 *    *newly analyzed page*: MARKO is seeing it for the first time (or for
 *    the first time successfully), so any findings on it are real findings
 *    but not evidence of regression — they must never be reported as
 *    "New" issues. They're tracked separately (`newlyAnalyzed`,
 *    `newlyAnalyzedPageCount`) instead.
 *  - A URL successfully analyzed in the previous run but not comparable
 *    (missing from, or unsuccessfully fetched in, the latest run) cannot
 *    have its previous issues honestly claimed as fixed — excluded from
 *    Resolved entirely (see `excludedPreviousIssueCount`), unchanged from
 *    the original protection this report already had.
 */

export type ComparisonPageRow = {
  id: string;
  crawl_run_id: string;
  url: string;
  http_status: number | null;
  fetch_error: string | null;
  /** Same seed-entry-redirect-artifact fields as CrawlPageRow (see
   * seoHealthReport.ts) — optional and purely additive: omitting them (or
   * omitting `registeredUrl` below) reproduces this module's exact
   * previous behavior. */
  final_url?: string | null;
  redirect_count?: number;
  canonical_url?: string | null;
};

export type ComparisonIssueRow = {
  crawl_run_id: string;
  crawl_page_id: string;
  issue_type: string;
};

export type ChangedIssue = {
  issueType: CrawlIssueType;
  category: IssueCategory;
  priority: IssuePriority;
  label: string;
  url: string;
};

export type RunRef = { id: string; startedAt: string };

export type SeoChangeReport =
  | { status: "no-previous-run"; latestRun: RunRef }
  | {
      status: "compared";
      latestRun: RunRef;
      previousRun: RunRef;
      summary: {
        resolvedCount: number;
        newCount: number;
        remainingCount: number;
        previousPagesWithIssues: number;
        currentPagesWithIssues: number;
        /** Previous issues that could not be verified as resolved because
         * their page wasn't successfully re-analyzed in the current run. */
        excludedPreviousIssueCount: number;
        /** URLs successfully analyzed in the latest run that were not
         * comparable to the previous run (first successful analysis ever,
         * or the first successful analysis after a previous failure).
         * Their findings appear in `newlyAnalyzed`, never in `newIssues`. */
        newlyAnalyzedPageCount: number;
        /** How many current+previous issue rows were excluded from every
         * count/list above as a seed-entry-redirect artifact (see
         * isSeedEntryRedirectArtifact in seoHealthReport.ts) — the same
         * exclusion buildSeoHealthReport applies to the SEO Health Summary,
         * kept consistent here so the two reports' totals never diverge.
         * Zero whenever `registeredUrl` isn't passed. */
        excludedSeedArtifactCount: number;
      };
      resolved: ChangedIssue[];
      newIssues: ChangedIssue[];
      remaining: ChangedIssue[];
      newlyAnalyzed: ChangedIssue[];
    };

const PRIORITY_ORDER: Record<IssuePriority, number> = { high: 0, medium: 1, low: 2 };

function isKnownIssueType(type: string): type is CrawlIssueType {
  return Object.prototype.hasOwnProperty.call(ISSUE_TAXONOMY, type);
}

function isSuccessfullyAnalyzed(page: ComparisonPageRow): boolean {
  return (
    page.fetch_error === null &&
    page.http_status !== null &&
    page.http_status >= 200 &&
    page.http_status < 300
  );
}

function issueKey(url: string, issueType: string): string {
  return `${url} ${issueType}`;
}

function toChangedIssue(url: string, issueType: CrawlIssueType): ChangedIssue {
  const taxonomy = ISSUE_TAXONOMY[issueType];
  return { issueType, category: taxonomy.category, priority: taxonomy.priority, label: taxonomy.label, url };
}

function sortChangedIssues(a: ChangedIssue, b: ChangedIssue): number {
  const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  if (priorityDiff !== 0) return priorityDiff;
  if (a.label !== b.label) return a.label < b.label ? -1 : 1;
  return a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
}

export function buildSeoChangeReport(params: {
  latestRun: RunRef;
  previousRun: RunRef | null;
  pages: ComparisonPageRow[];
  issues: ComparisonIssueRow[];
  /** The site's registered URL (`sites.url`) — optional and purely
   * additive: passing it enables the same seed-entry-redirect exclusion
   * buildSeoHealthReport applies (see isSeedEntryRedirectArtifact);
   * omitting it reproduces this function's exact previous behavior. */
  registeredUrl?: string;
}): SeoChangeReport {
  const { latestRun, previousRun, pages, issues, registeredUrl } = params;

  if (!previousRun) {
    return { status: "no-previous-run", latestRun };
  }

  const pageById = new Map(pages.map((p) => [p.id, p]));
  const currentPagesByUrl = new Map(
    pages.filter((p) => p.crawl_run_id === latestRun.id).map((p) => [p.url, p]),
  );
  const previousPagesByUrl = new Map(
    pages.filter((p) => p.crawl_run_id === previousRun.id).map((p) => [p.url, p]),
  );

  // A URL participates in Resolved/New/Remaining only if it was
  // successfully analyzed in *both* runs — this is what stops a page that
  // simply wasn't reachable/crawled before (e.g. one of the extra pages a
  // larger crawl cap now reaches) from having its findings misreported as
  // "New" regressions.
  function isComparable(url: string): boolean {
    const current = currentPagesByUrl.get(url);
    const previous = previousPagesByUrl.get(url);
    return (
      current !== undefined &&
      isSuccessfullyAnalyzed(current) &&
      previous !== undefined &&
      isSuccessfullyAnalyzed(previous)
    );
  }

  // Successfully analyzed this run, but not comparable to the previous run
  // — i.e. MARKO is seeing this URL succeed for the first time (never
  // crawled before, or crawled before but not successfully).
  const newlyAnalyzedUrls = new Set(
    [...currentPagesByUrl.values()]
      .filter((page) => isSuccessfullyAnalyzed(page) && !isComparable(page.url))
      .map((page) => page.url),
  );

  type Entry = { url: string; issueType: CrawlIssueType };
  const currentEntries: Entry[] = [];
  const previousEntries: Entry[] = [];
  let excludedSeedArtifactCount = 0;

  for (const issue of issues) {
    if (!isKnownIssueType(issue.issue_type)) continue;
    const page = pageById.get(issue.crawl_page_id);
    if (!page) continue;
    if (isSeedEntryRedirectArtifact(issue, page, registeredUrl)) {
      excludedSeedArtifactCount++;
      continue;
    }
    const entry: Entry = { url: page.url, issueType: issue.issue_type };
    if (page.crawl_run_id === latestRun.id) currentEntries.push(entry);
    else if (page.crawl_run_id === previousRun.id) previousEntries.push(entry);
  }

  const currentKeys = new Set(currentEntries.map((e) => issueKey(e.url, e.issueType)));
  const previousKeys = new Set(previousEntries.map((e) => issueKey(e.url, e.issueType)));

  const resolved: ChangedIssue[] = [];
  const remaining: ChangedIssue[] = [];
  const seenResolved = new Set<string>();
  const seenRemaining = new Set<string>();
  let excludedPreviousIssueCount = 0;

  for (const entry of previousEntries) {
    const key = issueKey(entry.url, entry.issueType);
    if (!isComparable(entry.url)) {
      excludedPreviousIssueCount++;
      continue;
    }
    if (currentKeys.has(key)) {
      if (!seenRemaining.has(key)) {
        seenRemaining.add(key);
        remaining.push(toChangedIssue(entry.url, entry.issueType));
      }
    } else if (!seenResolved.has(key)) {
      seenResolved.add(key);
      resolved.push(toChangedIssue(entry.url, entry.issueType));
    }
  }

  const newIssues: ChangedIssue[] = [];
  const seenNew = new Set<string>();
  for (const entry of currentEntries) {
    if (!isComparable(entry.url)) continue;
    const key = issueKey(entry.url, entry.issueType);
    if (!previousKeys.has(key) && !seenNew.has(key)) {
      seenNew.add(key);
      newIssues.push(toChangedIssue(entry.url, entry.issueType));
    }
  }

  const newlyAnalyzed: ChangedIssue[] = [];
  const seenNewlyAnalyzed = new Set<string>();
  for (const entry of currentEntries) {
    if (!newlyAnalyzedUrls.has(entry.url)) continue;
    const key = issueKey(entry.url, entry.issueType);
    if (!seenNewlyAnalyzed.has(key)) {
      seenNewlyAnalyzed.add(key);
      newlyAnalyzed.push(toChangedIssue(entry.url, entry.issueType));
    }
  }

  resolved.sort(sortChangedIssues);
  remaining.sort(sortChangedIssues);
  newIssues.sort(sortChangedIssues);
  newlyAnalyzed.sort(sortChangedIssues);

  return {
    status: "compared",
    latestRun,
    previousRun,
    summary: {
      resolvedCount: resolved.length,
      newCount: newIssues.length,
      remainingCount: remaining.length,
      previousPagesWithIssues: new Set(previousEntries.map((e) => e.url)).size,
      currentPagesWithIssues: new Set(currentEntries.map((e) => e.url)).size,
      excludedPreviousIssueCount,
      newlyAnalyzedPageCount: newlyAnalyzedUrls.size,
      excludedSeedArtifactCount,
    },
    resolved,
    newIssues,
    remaining,
    newlyAnalyzed,
  };
}
