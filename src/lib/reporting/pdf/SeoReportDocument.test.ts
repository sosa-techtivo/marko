import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { assembleSiteReportData, type SiteReportRawInput } from "../siteReportData";
import { SeoReportDocument } from "./SeoReportDocument";
import type { CrawlIssueRow, CrawlPageRow } from "../seoHealthReport";

/**
 * Rendering-level smoke tests only — the deterministic data layer
 * (assembleSiteReportData) already has heavy, focused coverage in
 * siteReportData.test.ts. These just confirm the React-PDF component tree
 * actually renders to valid PDF bytes for every input shape it must
 * handle, without throwing — including the "no completed crawl" and
 * "large volume of findings" edge cases, per the PDF feature's testing
 * requirements. Binary PDF content itself isn't asserted beyond the
 * magic-number header/non-trivial size — that's what the pure data-layer
 * tests are for.
 */

function page(overrides: Partial<CrawlPageRow> & { id: string; url: string }): CrawlPageRow {
  return {
    http_status: 200,
    title: "A Title",
    meta_description: "A description that is long enough to pass the length checks easily here.",
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

async function renderAndCheck(input: SiteReportRawInput) {
  const data = assembleSiteReportData(input);
  const buffer = await renderToBuffer(SeoReportDocument({ data }));
  expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  expect(buffer.length).toBeGreaterThan(500);
  return { data, buffer };
}

describe("SeoReportDocument — renders without throwing", () => {
  it("renders a full report with every section populated", async () => {
    const registeredUrl = "http://techtivo.com/";
    const effectiveUrl = "https://www.techtivo.com/";
    const pages: CrawlPageRow[] = [
      page({ id: "seed", url: registeredUrl, final_url: effectiveUrl, redirect_count: 1, canonical_url: effectiveUrl }),
      page({ id: "a", url: `${effectiveUrl}about/` }),
    ];
    const issues: CrawlIssueRow[] = [
      issue({ crawl_page_id: "seed", issue_type: "redirected" }),
      issue({ crawl_page_id: "seed", issue_type: "invalid_canonical" }),
      issue({ crawl_page_id: "a", issue_type: "multiple_h1" }),
    ];

    await renderAndCheck({
      ...BASE_INPUT,
      site: { name: "Techtivo", slug: "techtivo", url: registeredUrl, effective_url: effectiveUrl },
      latestRun: { id: "r2", status: "completed", started_at: "2026-09-04T10:00:00Z", completed_at: "2026-09-04T10:05:00Z", error_message: null },
      completedRuns: [
        { id: "r2", started_at: "2026-09-04T10:00:00Z", completed_at: "2026-09-04T10:05:00Z" },
        { id: "r1", started_at: "2026-09-01T10:00:00Z", completed_at: "2026-09-01T10:05:00Z" },
      ],
      latestCrawlPages: pages,
      latestCrawlIssues: issues,
      comparisonPages: [
        { id: "seed", crawl_run_id: "r2", url: registeredUrl, http_status: 200, fetch_error: null },
        { id: "a", crawl_run_id: "r2", url: `${effectiveUrl}about/`, http_status: 200, fetch_error: null },
      ],
      comparisonIssues: [{ crawl_run_id: "r2", crawl_page_id: "a", issue_type: "multiple_h1" }],
      searchConsoleSnapshot: {
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
      },
    });
  }, 15_000);

  it("renders safely for a site with no completed analysis at all", async () => {
    const { data } = await renderAndCheck(BASE_INPUT);
    expect(data.health).toBeNull();
  }, 15_000);

  it("renders safely with a long site name and long URLs", async () => {
    await renderAndCheck({
      ...BASE_INPUT,
      site: {
        name: "A Very Long Client Organization Name That Could Overflow A Narrow Header (Test Org #4)",
        slug: "long-name",
        url: "https://www.example-with-a-genuinely-long-hostname-for-testing.com/a/very/deeply/nested/path/segment/",
        effective_url: null,
      },
    });
  }, 15_000);

  it("renders safely with a large volume of opportunities and affected pages", async () => {
    const pages = Array.from({ length: 20 }, (_, i) => page({ id: `p${i}`, url: `https://example.com/p${i}` }));
    const issues = pages.flatMap((p) => [
      issue({ crawl_page_id: p.id, issue_type: "multiple_h1" }),
      issue({ crawl_page_id: p.id, issue_type: "meta_description_too_long" }),
      issue({ crawl_page_id: p.id, issue_type: "images_missing_alt" }),
    ]);

    await renderAndCheck({
      ...BASE_INPUT,
      latestRun: { id: "r1", status: "completed", started_at: "2026-09-04T10:00:00Z", completed_at: "2026-09-04T10:05:00Z", error_message: null },
      completedRuns: [{ id: "r1", started_at: "2026-09-04T10:00:00Z", completed_at: "2026-09-04T10:05:00Z" }],
      latestCrawlPages: pages,
      latestCrawlIssues: issues,
    });
  }, 15_000);

  it("omits the Search Console section cleanly when disconnected, without throwing", async () => {
    await renderAndCheck({
      ...BASE_INPUT,
      latestRun: { id: "r1", status: "completed", started_at: "2026-09-04T10:00:00Z", completed_at: "2026-09-04T10:05:00Z", error_message: null },
      completedRuns: [{ id: "r1", started_at: "2026-09-04T10:00:00Z", completed_at: "2026-09-04T10:05:00Z" }],
      latestCrawlPages: [page({ id: "a", url: "https://example.com/" })],
      searchConsoleSnapshot: { status: "not_connected" },
    });
  }, 15_000);
});
