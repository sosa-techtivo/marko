import type { AnalyzedPage, CrawlIssue } from "./analyze";

/**
 * Crawl-level (cross-page) checks: duplicate title/meta description, and
 * canonical targets that multiple crawled pages unexpectedly consolidate
 * onto. Kept separate from analyze.ts's page-level checks, which have no
 * visibility into other pages in the same run.
 *
 * Run once over the full set of pages from a single crawl, after page-level
 * analysis — see runCrawl.ts.
 */

function normalizeForComparison(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Groups pages by a key; pages whose keyFn returns null are excluded entirely. */
function groupBy(
  pages: AnalyzedPage[],
  keyFn: (page: AnalyzedPage) => string | null,
): Map<string, AnalyzedPage[]> {
  const groups = new Map<string, AnalyzedPage[]>();
  for (const page of pages) {
    const key = keyFn(page);
    if (key === null) continue;
    const list = groups.get(key) ?? [];
    list.push(page);
    groups.set(key, list);
  }
  return groups;
}

export function applyCrossPageChecks(pages: AnalyzedPage[]): AnalyzedPage[] {
  const extraIssuesByUrl = new Map<string, CrawlIssue[]>();

  function addIssue(url: string, issue: CrawlIssue) {
    const list = extraIssuesByUrl.get(url) ?? [];
    list.push(issue);
    extraIssuesByUrl.set(url, list);
  }

  // A page that redirected elsewhere has no independent content of its own
  // — it's the same response as its destination. Comparing it here would
  // produce false "duplicate"/"chain" findings against the very URL it
  // redirects to (or, transitively, against any other page that happens to
  // share that destination). Excluded from every check below; the
  // redirect itself is still reported as its own `redirected` finding from
  // analyze.ts, and the page is still returned in the final output —
  // it just never contributes to or receives a cross-page finding here.
  const contentPages = pages.filter((p) => p.redirectCount === 0);

  const titleGroups = groupBy(contentPages, (p) => (p.title ? normalizeForComparison(p.title) : null));
  for (const group of titleGroups.values()) {
    if (group.length < 2) continue;
    for (const page of group) {
      addIssue(page.url, {
        type: "duplicate_title",
        severity: "warning",
        message: `This page's title is identical to ${group.length - 1} other analyzed page${group.length - 1 === 1 ? "" : "s"}, which makes it harder for search engines to tell them apart.`,
      });
    }
  }

  const metaGroups = groupBy(contentPages, (p) =>
    p.metaDescription ? normalizeForComparison(p.metaDescription) : null,
  );
  for (const group of metaGroups.values()) {
    if (group.length < 2) continue;
    for (const page of group) {
      addIssue(page.url, {
        type: "duplicate_meta_description",
        severity: "warning",
        message: `This page's meta description is identical to ${group.length - 1} other analyzed page${group.length - 1 === 1 ? "" : "s"}.`,
      });
    }
  }

  // Only consider canonicals that are already known-valid/same-host (pages
  // with an `invalid_canonical` finding are excluded here — that problem is
  // reported separately, and re-flagging them as a "duplicate" target would
  // just compound noise on an already-broken canonical).
  const validCanonicalPages = contentPages.filter(
    (p) => p.canonicalUrl !== null && !p.issues.some((issue) => issue.type === "invalid_canonical"),
  );
  const canonicalGroups = groupBy(validCanonicalPages, (p) => p.canonicalUrl);
  for (const [target, group] of canonicalGroups) {
    // A page whose own URL *is* the shared target is the legitimate
    // canonical "hub" self-referencing itself — never flagged. Only the
    // *other* pages deferring to it count toward the threshold, and only
    // when at least two distinct, otherwise-unrelated pages do so — a
    // single duplicate deferring to one canonical page is ordinary,
    // expected canonical usage, not a bug.
    const deferring = group.filter((p) => p.url !== target);
    if (deferring.length < 2) continue;
    for (const page of deferring) {
      addIssue(page.url, {
        type: "duplicate_canonical",
        severity: "warning",
        message: `This page's canonical tag points to the same URL (${target}) as ${deferring.length - 1} other analyzed page${deferring.length - 1 === 1 ? "" : "s"}, which may unexpectedly consolidate distinct pages in search results.`,
      });
    }
  }

  // Canonical chains: page P defers (via canonical) to another crawled page
  // Q, but Q itself defers elsewhere instead of self-referencing — search
  // engines are not guaranteed to follow the chain to wherever it actually
  // terminates. Only considered for canonicals already known-valid/
  // same-host (same `validCanonicalPages` exclusion as above), and only
  // when the target is one of the *other* pages actually crawled in this
  // run — a target this crawl didn't fetch isn't something MARKO can
  // confirm chains further, so it's deliberately not flagged as a guess.
  const crawledPageByUrl = new Map(validCanonicalPages.map((p) => [p.url, p]));
  for (const page of validCanonicalPages) {
    if (page.canonicalUrl === null || page.canonicalUrl === page.url) continue;
    const target = crawledPageByUrl.get(page.canonicalUrl);
    if (!target) continue;
    if (target.canonicalUrl !== null && target.canonicalUrl !== target.url) {
      addIssue(page.url, {
        type: "canonical_chain",
        severity: "warning",
        message: `This page's canonical points to ${target.url}, which itself has a canonical pointing elsewhere (${target.canonicalUrl}) instead of to itself — search engines may not resolve this chain the way you intend.`,
      });
    }
  }

  if (extraIssuesByUrl.size === 0) return pages;

  return pages.map((page) => {
    const extra = extraIssuesByUrl.get(page.url);
    return extra ? { ...page, issues: [...page.issues, ...extra] } : page;
  });
}
