import { describe, expect, it } from "vitest";
import { buildSeoHealthReport, type CrawlIssueRow, type CrawlPageRow } from "./seoHealthReport";
import { deriveSiteHealthSummaryFromCounts } from "./siteHealthStatus";

function page(overrides: Partial<CrawlPageRow> & { id: string; url: string }): CrawlPageRow {
  return {
    http_status: 200,
    title: "A Title",
    meta_description: "A description that is long enough to pass the length checks easily.",
    h1: "Heading",
    canonical_url: overrides.url,
    is_indexable: true,
    final_url: overrides.url,
    redirect_count: 0,
    ...overrides,
  };
}

function issue(overrides: Partial<CrawlIssueRow> & { crawl_page_id: string; issue_type: string }): CrawlIssueRow {
  return {
    id: `${overrides.crawl_page_id}-${overrides.issue_type}`,
    message: "A finding.",
    ...overrides,
  };
}

const REGISTERED_URL = "http://techtivo.com/";
const EFFECTIVE_URL = "https://www.techtivo.com/";

describe("buildSeoHealthReport — seed entry redirect exclusion", () => {
  it("does not inflate the main opportunity total for a seed page that redirects to its effective URL with a matching canonical", () => {
    const pages: CrawlPageRow[] = [
      page({
        id: "seed",
        url: REGISTERED_URL,
        final_url: EFFECTIVE_URL,
        redirect_count: 1,
        canonical_url: EFFECTIVE_URL,
      }),
      page({ id: "about", url: "https://www.techtivo.com/about/" }),
    ];
    const issues: CrawlIssueRow[] = [
      issue({ crawl_page_id: "seed", issue_type: "redirected" }),
      issue({ crawl_page_id: "seed", issue_type: "invalid_canonical" }),
      issue({ crawl_page_id: "about", issue_type: "multiple_h1" }),
    ];

    const report = buildSeoHealthReport(pages, issues, REGISTERED_URL);

    expect(report.summary.totalIssues).toBe(1);
    expect(report.summary.pagesWithIssues).toBe(1);
    expect(report.opportunities.map((o) => o.issueType)).toEqual(["multiple_h1"]);
    // Crawl coverage itself is unaffected — both pages were still analyzed.
    expect(report.summary.pagesAnalyzed).toBe(2);
  });

  it("still counts a redirect on a non-seed page", () => {
    const pages: CrawlPageRow[] = [
      page({ id: "seed", url: REGISTERED_URL, final_url: EFFECTIVE_URL, redirect_count: 1 }),
      page({
        id: "old-page",
        url: "https://www.techtivo.com/old-page",
        final_url: "https://www.techtivo.com/new-page",
        redirect_count: 1,
      }),
    ];
    const issues: CrawlIssueRow[] = [
      issue({ crawl_page_id: "seed", issue_type: "redirected" }),
      issue({ crawl_page_id: "old-page", issue_type: "redirected" }),
    ];

    const report = buildSeoHealthReport(pages, issues, REGISTERED_URL);

    expect(report.summary.totalIssues).toBe(1);
    expect(report.opportunities.map((o) => o.issueType)).toEqual(["redirected"]);
    expect(report.opportunities[0].affectedPages).toEqual([
      { url: "https://www.techtivo.com/old-page", message: "A finding." },
    ]);
  });

  it("still counts a genuine invalid_canonical on the seed page that does not point at the effective URL", () => {
    const pages: CrawlPageRow[] = [
      page({
        id: "seed",
        url: REGISTERED_URL,
        final_url: EFFECTIVE_URL,
        redirect_count: 1,
        canonical_url: "https://some-other-domain.example/",
      }),
    ];
    const issues: CrawlIssueRow[] = [
      issue({ crawl_page_id: "seed", issue_type: "redirected" }),
      issue({ crawl_page_id: "seed", issue_type: "invalid_canonical" }),
    ];

    const report = buildSeoHealthReport(pages, issues, REGISTERED_URL);

    // `redirected` is still excluded (the seed genuinely did redirect to
    // its effective URL), but this canonical points somewhere else
    // entirely — a real problem, not an artifact of the entry redirect.
    expect(report.summary.totalIssues).toBe(1);
    expect(report.opportunities.map((o) => o.issueType)).toEqual(["invalid_canonical"]);
  });

  it("still counts invalid_canonical on the seed when the canonical is empty/unparsable (not the entry-redirect case)", () => {
    const pages: CrawlPageRow[] = [
      page({
        id: "seed",
        url: REGISTERED_URL,
        final_url: EFFECTIVE_URL,
        redirect_count: 1,
        canonical_url: null,
      }),
    ];
    const issues: CrawlIssueRow[] = [
      issue({ crawl_page_id: "seed", issue_type: "invalid_canonical" }),
    ];

    const report = buildSeoHealthReport(pages, issues, REGISTERED_URL);
    expect(report.summary.totalIssues).toBe(1);
  });

  it("leaves no-redirect site behavior completely unchanged", () => {
    const pages: CrawlPageRow[] = [
      page({ id: "seed", url: "https://example.com/", final_url: "https://example.com/", redirect_count: 0 }),
      page({ id: "about", url: "https://example.com/about" }),
    ];
    const issues: CrawlIssueRow[] = [
      issue({ crawl_page_id: "seed", issue_type: "multiple_h1" }),
      issue({ crawl_page_id: "about", issue_type: "meta_description_too_long" }),
    ];

    const report = buildSeoHealthReport(pages, issues, "https://example.com/");
    expect(report.summary.totalIssues).toBe(2);
    expect(report.opportunities.map((o) => o.issueType).sort()).toEqual([
      "meta_description_too_long",
      "multiple_h1",
    ]);
  });

  it("preserves prior behavior entirely when no registeredUrl is provided", () => {
    const pages: CrawlPageRow[] = [
      page({
        id: "seed",
        url: REGISTERED_URL,
        final_url: EFFECTIVE_URL,
        redirect_count: 1,
        canonical_url: EFFECTIVE_URL,
      }),
    ];
    const issues: CrawlIssueRow[] = [
      issue({ crawl_page_id: "seed", issue_type: "redirected" }),
      issue({ crawl_page_id: "seed", issue_type: "invalid_canonical" }),
    ];

    const report = buildSeoHealthReport(pages, issues);
    expect(report.summary.totalIssues).toBe(2);
  });

  it("preserves prior behavior when pages carry no final_url/redirect_count at all", () => {
    const pages: CrawlPageRow[] = [
      {
        id: "seed",
        url: REGISTERED_URL,
        http_status: 200,
        title: "A Title",
        meta_description: "A description that is long enough to pass the length checks easily.",
        h1: "Heading",
        canonical_url: EFFECTIVE_URL,
        is_indexable: true,
        // final_url/redirect_count deliberately omitted
      },
    ];
    const issues: CrawlIssueRow[] = [
      issue({ crawl_page_id: "seed", issue_type: "redirected" }),
      issue({ crawl_page_id: "seed", issue_type: "invalid_canonical" }),
    ];

    const report = buildSeoHealthReport(pages, issues, REGISTERED_URL);
    expect(report.summary.totalIssues).toBe(2);
  });
});

describe("Sites list vs. site detail consistency (the exact Techtivo A/B scenario)", () => {
  it("a redirecting registered URL and its non-redirecting effective-URL twin produce identical totals and status — the same pipeline the Sites list and site detail both run", () => {
    const effectivePages: CrawlPageRow[] = [
      page({ id: "home", url: "https://www.techtivo.com/" }),
      page({ id: "about", url: "https://www.techtivo.com/about-us/" }),
    ];
    const effectiveIssues: CrawlIssueRow[] = [
      issue({ crawl_page_id: "home", issue_type: "multiple_h1" }),
      issue({ crawl_page_id: "about", issue_type: "meta_description_too_long" }),
    ];

    // Site A: registered exactly at the effective URL — no redirect.
    const siteAPages = effectivePages;
    const siteAIssues = effectiveIssues;

    // Site B: registered at a URL that redirects to the same effective
    // site — its seed page carries the two entry-only findings on top of
    // the same underlying content findings.
    const siteBPages: CrawlPageRow[] = [
      page({
        id: "home",
        url: REGISTERED_URL,
        final_url: EFFECTIVE_URL,
        redirect_count: 1,
        canonical_url: EFFECTIVE_URL,
      }),
      effectivePages[1],
    ];
    const siteBIssues: CrawlIssueRow[] = [
      ...effectiveIssues,
      issue({ crawl_page_id: "home", issue_type: "redirected" }),
      issue({ crawl_page_id: "home", issue_type: "invalid_canonical" }),
    ];

    const reportA = buildSeoHealthReport(siteAPages, siteAIssues, EFFECTIVE_URL);
    const reportB = buildSeoHealthReport(siteBPages, siteBIssues, REGISTERED_URL);

    expect(reportA.summary.totalIssues).toBe(2);
    expect(reportB.summary.totalIssues).toBe(2);
    expect(reportA.summary).toEqual(reportB.summary);
    expect(reportA.opportunities.map((o) => o.issueType).sort()).toEqual(
      reportB.opportunities.map((o) => o.issueType).sort(),
    );

    // The same downstream step the Sites list and site detail page both
    // take — status must agree too, not just the raw counts.
    const healthA = deriveSiteHealthSummaryFromCounts(
      reportA.summary.totalIssues,
      reportA.summary.highPriorityIssues,
    );
    const healthB = deriveSiteHealthSummaryFromCounts(
      reportB.summary.totalIssues,
      reportB.summary.highPriorityIssues,
    );
    expect(healthA).toEqual(healthB);
  });
});

describe("buildSeoHealthReport — general aggregation (unaffected by the exclusion)", () => {
  it("groups opportunities by issue type across pages, sorted by priority then affected-page count", () => {
    const pages: CrawlPageRow[] = [
      page({ id: "a", url: "https://example.com/a" }),
      page({ id: "b", url: "https://example.com/b" }),
    ];
    const issues: CrawlIssueRow[] = [
      issue({ crawl_page_id: "a", issue_type: "missing_title" }),
      issue({ crawl_page_id: "b", issue_type: "missing_h1" }),
    ];

    const report = buildSeoHealthReport(pages, issues);
    expect(report.summary.highPriorityIssues).toBe(1); // missing_title is High
    expect(report.opportunities[0].issueType).toBe("missing_title");
  });

  it("reports positive signals only when there are zero counted issues", () => {
    const pages: CrawlPageRow[] = [page({ id: "a", url: "https://example.com/" })];
    const report = buildSeoHealthReport(pages, []);
    expect(report.positiveSignals.length).toBeGreaterThan(0);
  });
});
