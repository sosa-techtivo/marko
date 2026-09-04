import { describe, expect, it } from "vitest";
import { assembleSiteReportData, type SiteReportRawInput } from "./siteReportData";
import type { CrawlIssueRow, CrawlPageRow } from "./seoHealthReport";
import type { SiteSnapshotResult } from "@/lib/googleSearchConsole/siteSnapshot";

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
  return { id: `${overrides.crawl_page_id}-${overrides.issue_type}`, message: "A finding.", ...overrides };
}

const BASE_INPUT: SiteReportRawInput = {
  site: { name: "Techtivo", slug: "techtivo", url: "https://example.com/", effective_url: null },
  now: new Date("2026-09-04T12:00:00.000Z"),
  latestRun: null,
  completedRuns: [],
  latestCrawlPages: [],
  latestCrawlIssues: [],
  comparisonPages: [],
  comparisonIssues: [],
  searchConsoleSnapshot: null,
};

describe("assembleSiteReportData — matches Site Detail's interpreted totals", () => {
  it("uses buildSeoHealthReport's interpreted totals, not a raw crawl_issues count", () => {
    const data = assembleSiteReportData({
      ...BASE_INPUT,
      latestRun: { id: "run-1", status: "completed", started_at: "2026-09-04T10:00:00Z", completed_at: "2026-09-04T10:05:00Z", error_message: null },
      completedRuns: [{ id: "run-1", started_at: "2026-09-04T10:00:00Z", completed_at: "2026-09-04T10:05:00Z" }],
      latestCrawlPages: [page({ id: "a", url: "https://example.com/a" })],
      latestCrawlIssues: [
        issue({ crawl_page_id: "a", issue_type: "missing_title" }),
        issue({ crawl_page_id: "a", issue_type: "missing_h1" }),
      ],
    });

    expect(data.health?.summary.totalIssues).toBe(2);
    expect(data.health?.summary.pagesAnalyzed).toBe(1);
    expect(data.siteHealthStatus.status).toBe("critical"); // missing_title is High
  });

  it("seed-entry redirect artifacts do not reappear in the PDF's totals (the exact Techtivo case)", () => {
    const registeredUrl = "http://techtivo.com/";
    const effectiveUrl = "https://www.techtivo.com/";

    const data = assembleSiteReportData({
      ...BASE_INPUT,
      site: { name: "Techtivo", slug: "techtivo", url: registeredUrl, effective_url: effectiveUrl },
      latestRun: { id: "run-1", status: "completed", started_at: "2026-09-04T10:00:00Z", completed_at: "2026-09-04T10:05:00Z", error_message: null },
      completedRuns: [{ id: "run-1", started_at: "2026-09-04T10:00:00Z", completed_at: "2026-09-04T10:05:00Z" }],
      latestCrawlPages: [
        page({ id: "seed", url: registeredUrl, final_url: effectiveUrl, redirect_count: 1, canonical_url: effectiveUrl }),
        page({ id: "about", url: "https://www.techtivo.com/about/" }),
      ],
      latestCrawlIssues: [
        issue({ crawl_page_id: "seed", issue_type: "redirected" }),
        issue({ crawl_page_id: "seed", issue_type: "invalid_canonical" }),
        issue({ crawl_page_id: "about", issue_type: "multiple_h1" }),
      ],
    });

    expect(data.health?.summary.totalIssues).toBe(1);
    expect(data.health?.opportunities.map((o) => o.issueType)).toEqual(["multiple_h1"]);
  });

  it("registered/effective URL handling: notes the redirect and exposes both URLs", () => {
    const data = assembleSiteReportData({
      ...BASE_INPUT,
      site: {
        name: "Techtivo",
        slug: "techtivo",
        url: "http://techtivo.com/",
        effective_url: "https://www.techtivo.com/",
      },
    });

    expect(data.site.registeredUrl).toBe("http://techtivo.com/");
    expect(data.site.effectiveUrl).toBe("https://www.techtivo.com/");
    expect(data.site.registeredUrlRedirectNote).toBe("techtivo.com redirects to www.techtivo.com");
  });

  it("registered/effective URL handling: no note and effectiveUrl falls back when no redirect is known", () => {
    const data = assembleSiteReportData({
      ...BASE_INPUT,
      site: { name: "Techtivo", slug: "techtivo", url: "https://www.techtivo.com/", effective_url: null },
    });

    expect(data.site.effectiveUrl).toBe("https://www.techtivo.com/");
    expect(data.site.registeredUrlRedirectNote).toBeNull();
  });
});

describe("assembleSiteReportData — no completed crawl", () => {
  it("handles a site with no completed analysis safely, with no throw", () => {
    const data = assembleSiteReportData(BASE_INPUT);

    expect(data.health).toBeNull();
    expect(data.siteHealthStatus.status).toBe("not_analyzed");
    expect(data.changeReport).toBeNull();
    expect(data.insights).toEqual([]);
    expect(data.latestCompletedRun).toBeNull();
  });
});

describe("assembleSiteReportData — Search Console inclusion", () => {
  const okSnapshotWithData: Extract<SiteSnapshotResult, { status: "ok" }> = {
    status: "ok",
    snapshot: {
      current: { clicks: 10, impressions: 100, ctr: 0.1, position: 5, hasData: true },
      previous: { clicks: 5, impressions: 50, ctr: 0.1, position: 6, hasData: true },
      delta: { clicks: 5, impressions: 50, ctr: 0, position: -1 },
      dateRanges: {
        current: { startDate: "2026-08-01", endDate: "2026-08-28" },
        previous: { startDate: "2026-07-04", endDate: "2026-07-31" },
      },
    },
  };

  it("includes the section when the snapshot is ok and has data", () => {
    const data = assembleSiteReportData({ ...BASE_INPUT, searchConsoleSnapshot: okSnapshotWithData });
    expect(data.searchConsole).not.toBeNull();
    expect(data.searchConsole?.snapshot.current.clicks).toBe(10);
  });

  it("omits the section (never fails) when Search Console is not connected", () => {
    const data = assembleSiteReportData({ ...BASE_INPUT, searchConsoleSnapshot: { status: "not_connected" } });
    expect(data.searchConsole).toBeNull();
  });

  it("omits the section when reconnection is needed", () => {
    const data = assembleSiteReportData({ ...BASE_INPUT, searchConsoleSnapshot: { status: "needs_reauth" } });
    expect(data.searchConsole).toBeNull();
  });

  it("omits the section on an API error, rather than surfacing it in a client-facing report", () => {
    const data = assembleSiteReportData({
      ...BASE_INPUT,
      searchConsoleSnapshot: { status: "error", message: "Google Search Console rate-limited this request." },
    });
    expect(data.searchConsole).toBeNull();
  });

  it("omits the section when connected/matched but the period has no data yet", () => {
    const noDataSnapshot: SiteSnapshotResult = {
      status: "ok",
      snapshot: {
        ...okSnapshotWithData.snapshot,
        current: { clicks: 0, impressions: 0, ctr: 0, position: 0, hasData: false },
      },
    };
    const result = assembleSiteReportData({ ...BASE_INPUT, searchConsoleSnapshot: noDataSnapshot });
    expect(result.searchConsole).toBeNull();
  });

  it("omits the section when null (GSC not applicable at all) with no throw", () => {
    const data = assembleSiteReportData({ ...BASE_INPUT, searchConsoleSnapshot: null });
    expect(data.searchConsole).toBeNull();
  });
});

describe("assembleSiteReportData — historical comparison semantics", () => {
  it("uses buildSeoChangeReport's exact resolved/new/remaining/newly-analyzed classification", () => {
    const data = assembleSiteReportData({
      ...BASE_INPUT,
      latestRun: { id: "run-2", status: "completed", started_at: "2026-09-04T10:00:00Z", completed_at: "2026-09-04T10:05:00Z", error_message: null },
      completedRuns: [
        { id: "run-2", started_at: "2026-09-04T10:00:00Z", completed_at: "2026-09-04T10:05:00Z" },
        { id: "run-1", started_at: "2026-09-01T10:00:00Z", completed_at: "2026-09-01T10:05:00Z" },
      ],
      latestCrawlPages: [page({ id: "a2", url: "https://example.com/a" })],
      latestCrawlIssues: [issue({ id: "i1", crawl_page_id: "a2", issue_type: "missing_h1" })],
      comparisonPages: [
        { id: "a1", crawl_run_id: "run-1", url: "https://example.com/a", http_status: 200, fetch_error: null },
        { id: "a2", crawl_run_id: "run-2", url: "https://example.com/a", http_status: 200, fetch_error: null },
      ],
      comparisonIssues: [
        { crawl_run_id: "run-1", crawl_page_id: "a1", issue_type: "missing_title" },
        { crawl_run_id: "run-2", crawl_page_id: "a2", issue_type: "missing_h1" },
      ],
    });

    expect(data.changeReport?.status).toBe("compared");
    if (data.changeReport?.status !== "compared") return;
    expect(data.changeReport.resolved.map((c) => c.issueType)).toEqual(["missing_title"]);
    expect(data.changeReport.newIssues.map((c) => c.issueType)).toEqual(["missing_h1"]);
  });

  it("states no comparable previous analysis when there is only one completed run", () => {
    const data = assembleSiteReportData({
      ...BASE_INPUT,
      latestRun: { id: "run-1", status: "completed", started_at: "2026-09-04T10:00:00Z", completed_at: "2026-09-04T10:05:00Z", error_message: null },
      completedRuns: [{ id: "run-1", started_at: "2026-09-04T10:00:00Z", completed_at: "2026-09-04T10:05:00Z" }],
      latestCrawlPages: [page({ id: "a", url: "https://example.com/a" })],
    });

    expect(data.changeReport?.status).toBe("no-previous-run");
  });
});

describe("assembleSiteReportData — long content does not break report data preparation", () => {
  it("handles many pages/issues/insights without throwing", () => {
    const pages = Array.from({ length: 20 }, (_, i) => page({ id: `p${i}`, url: `https://example.com/p${i}` }));
    const issues = pages.flatMap((p) => [
      issue({ crawl_page_id: p.id, issue_type: "multiple_h1" }),
      issue({ crawl_page_id: p.id, issue_type: "meta_description_too_long" }),
    ]);

    const data = assembleSiteReportData({
      ...BASE_INPUT,
      latestRun: { id: "run-1", status: "completed", started_at: "2026-09-04T10:00:00Z", completed_at: "2026-09-04T10:05:00Z", error_message: null },
      completedRuns: [{ id: "run-1", started_at: "2026-09-04T10:00:00Z", completed_at: "2026-09-04T10:05:00Z" }],
      latestCrawlPages: pages,
      latestCrawlIssues: issues,
    });

    expect(data.health?.summary.totalIssues).toBe(40);
    expect(data.health?.opportunities.every((o) => o.affectedPages.length <= 20)).toBe(true);
  });
});
