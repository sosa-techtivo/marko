import { describe, expect, it } from "vitest";
import {
  buildSeoChangeReport,
  type ComparisonIssueRow,
  type ComparisonPageRow,
} from "./seoChangeReport";

const PREVIOUS_RUN = { id: "run-previous", startedAt: "2026-08-01T00:00:00.000Z" };
const LATEST_RUN = { id: "run-latest", startedAt: "2026-08-15T00:00:00.000Z" };

function page(
  id: string,
  runId: string,
  url: string,
  overrides: Partial<ComparisonPageRow> = {},
): ComparisonPageRow {
  return { id, crawl_run_id: runId, url, http_status: 200, fetch_error: null, ...overrides };
}

function issue(runId: string, pageId: string, issueType: string): ComparisonIssueRow {
  return { crawl_run_id: runId, crawl_page_id: pageId, issue_type: issueType };
}

function compare(pages: ComparisonPageRow[], issues: ComparisonIssueRow[]) {
  const report = buildSeoChangeReport({
    latestRun: LATEST_RUN,
    previousRun: PREVIOUS_RUN,
    pages,
    issues,
  });
  if (report.status !== "compared") throw new Error("expected a compared report");
  return report;
}

describe("buildSeoChangeReport — expanded coverage (5 → 20 pages) semantics", () => {
  it("does not classify a finding on a URL only crawled in the larger latest run as New", () => {
    // Previous run only ever reached 5 pages; the latest, larger-cap run
    // reaches a 6th URL never analyzed before, which has a real issue.
    const previousPages = Array.from({ length: 5 }, (_, i) => page(`prev-${i}`, PREVIOUS_RUN.id, `https://example.com/p${i}`));
    const latestPages = [
      ...Array.from({ length: 5 }, (_, i) => page(`cur-${i}`, LATEST_RUN.id, `https://example.com/p${i}`)),
      page("cur-new", LATEST_RUN.id, "https://example.com/never-before-crawled"),
    ];
    const issues = [issue(LATEST_RUN.id, "cur-new", "missing_title")];

    const report = compare([...previousPages, ...latestPages], issues);

    expect(report.newIssues).toEqual([]);
    expect(report.summary.newCount).toBe(0);
  });

  it("counts the newly-analyzed URL and surfaces its findings under newlyAnalyzed instead", () => {
    const previousPages = [page("prev-1", PREVIOUS_RUN.id, "https://example.com/a")];
    const latestPages = [
      page("cur-1", LATEST_RUN.id, "https://example.com/a"),
      page("cur-2", LATEST_RUN.id, "https://example.com/b"),
    ];
    const issues = [issue(LATEST_RUN.id, "cur-2", "missing_meta_description")];

    const report = compare([...previousPages, ...latestPages], issues);

    expect(report.summary.newlyAnalyzedPageCount).toBe(1);
    expect(report.newlyAnalyzed).toHaveLength(1);
    expect(report.newlyAnalyzed[0]).toMatchObject({
      url: "https://example.com/b",
      issueType: "missing_meta_description",
    });
    expect(report.newIssues).toEqual([]);
  });

  it("still classifies a finding introduced on a URL analyzed successfully in both runs as New", () => {
    const previousPages = [page("prev-1", PREVIOUS_RUN.id, "https://example.com/a")];
    const latestPages = [page("cur-1", LATEST_RUN.id, "https://example.com/a")];
    const issues = [issue(LATEST_RUN.id, "cur-1", "missing_title")];

    const report = compare([...previousPages, ...latestPages], issues);

    expect(report.newIssues).toHaveLength(1);
    expect(report.newIssues[0]).toMatchObject({ url: "https://example.com/a", issueType: "missing_title" });
    expect(report.summary.newCount).toBe(1);
    expect(report.summary.newlyAnalyzedPageCount).toBe(0);
  });

  it("still classifies a finding removed from a URL analyzed successfully in both runs as Resolved", () => {
    const previousPages = [page("prev-1", PREVIOUS_RUN.id, "https://example.com/a")];
    const latestPages = [page("cur-1", LATEST_RUN.id, "https://example.com/a")];
    const issues = [issue(PREVIOUS_RUN.id, "prev-1", "missing_title")];

    const report = compare([...previousPages, ...latestPages], issues);

    expect(report.resolved).toHaveLength(1);
    expect(report.resolved[0]).toMatchObject({ url: "https://example.com/a", issueType: "missing_title" });
    expect(report.summary.resolvedCount).toBe(1);
  });

  it("still classifies an unchanged finding on a comparable URL as Remaining", () => {
    const previousPages = [page("prev-1", PREVIOUS_RUN.id, "https://example.com/a")];
    const latestPages = [page("cur-1", LATEST_RUN.id, "https://example.com/a")];
    const issues = [
      issue(PREVIOUS_RUN.id, "prev-1", "missing_h1"),
      issue(LATEST_RUN.id, "cur-1", "missing_h1"),
    ];

    const report = compare([...previousPages, ...latestPages], issues);

    expect(report.remaining).toHaveLength(1);
    expect(report.remaining[0]).toMatchObject({ url: "https://example.com/a", issueType: "missing_h1" });
    expect(report.summary.remainingCount).toBe(1);
    expect(report.newIssues).toEqual([]);
    expect(report.resolved).toEqual([]);
  });

  it("does not resolve a previous issue whose page was unreachable/failed in the latest run", () => {
    const previousPages = [page("prev-1", PREVIOUS_RUN.id, "https://example.com/a")];
    const latestPages = [
      page("cur-1", LATEST_RUN.id, "https://example.com/a", {
        http_status: null,
        fetch_error: "Timed out after 8s",
      }),
    ];
    const issues = [issue(PREVIOUS_RUN.id, "prev-1", "missing_title")];

    const report = compare([...previousPages, ...latestPages], issues);

    expect(report.resolved).toEqual([]);
    expect(report.summary.resolvedCount).toBe(0);
    expect(report.summary.excludedPreviousIssueCount).toBe(1);
  });

  it("does not resolve a previous issue for a URL entirely missing from the latest run", () => {
    const previousPages = [
      page("prev-1", PREVIOUS_RUN.id, "https://example.com/a"),
      page("prev-2", PREVIOUS_RUN.id, "https://example.com/gone"),
    ];
    const latestPages = [page("cur-1", LATEST_RUN.id, "https://example.com/a")];
    const issues = [issue(PREVIOUS_RUN.id, "prev-2", "missing_title")];

    const report = compare([...previousPages, ...latestPages], issues);

    expect(report.resolved).toEqual([]);
    expect(report.summary.excludedPreviousIssueCount).toBe(1);
  });

  it("counts newly analyzed pages correctly, including ones with zero findings", () => {
    const previousPages = [page("prev-1", PREVIOUS_RUN.id, "https://example.com/a")];
    const latestPages = [
      page("cur-1", LATEST_RUN.id, "https://example.com/a"),
      page("cur-2", LATEST_RUN.id, "https://example.com/b"), // no issues at all
      page("cur-3", LATEST_RUN.id, "https://example.com/c"), // no issues at all
      // A URL that was in the previous run but failed there — succeeding
      // for the first time now also counts as newly analyzed.
      page("cur-4", LATEST_RUN.id, "https://example.com/d"),
    ];
    const previousFailedPage = page("prev-d", PREVIOUS_RUN.id, "https://example.com/d", {
      http_status: null,
      fetch_error: "Timed out after 8s",
    });

    const report = compare([...previousPages, previousFailedPage, ...latestPages], []);

    expect(report.summary.newlyAnalyzedPageCount).toBe(3);
  });

  it("a full 5-page previous run vs. 20-page latest run only compares the 5 overlapping URLs", () => {
    const previousPages = Array.from({ length: 5 }, (_, i) =>
      page(`prev-${i}`, PREVIOUS_RUN.id, `https://example.com/p${i}`),
    );
    const latestPages = Array.from({ length: 20 }, (_, i) =>
      page(`cur-${i}`, LATEST_RUN.id, `https://example.com/p${i}`),
    );
    // A brand-new finding on one of the 15 newly-reached pages...
    const newlyReachedIssue = issue(LATEST_RUN.id, "cur-10", "missing_h1");
    // ...and a genuine new regression on a page crawled in both runs.
    const genuineNewIssue = issue(LATEST_RUN.id, "cur-0", "missing_title");

    const report = compare([...previousPages, ...latestPages], [newlyReachedIssue, genuineNewIssue]);

    expect(report.summary.newlyAnalyzedPageCount).toBe(15);
    expect(report.newIssues).toHaveLength(1);
    expect(report.newIssues[0]).toMatchObject({ url: "https://example.com/p0", issueType: "missing_title" });
    expect(report.newlyAnalyzed).toHaveLength(1);
    expect(report.newlyAnalyzed[0]).toMatchObject({ url: "https://example.com/p10", issueType: "missing_h1" });
  });
});

describe("buildSeoChangeReport — seed-entry-redirect artifact exclusion", () => {
  const REGISTERED_URL = "http://techtivo.com/";
  const EFFECTIVE_URL = "https://www.techtivo.com/";

  it("excludes the registered seed's redirected/invalid_canonical findings from Remaining, matching buildSeoHealthReport (the 35 vs. 37 fix)", () => {
    // The seed page redirects in both runs — same artifact present in the
    // previous and the latest analysis, so without the fix it would show
    // up as "Remaining" and inflate the client-facing total beyond what
    // the SEO Health Summary (buildSeoHealthReport) already reports.
    const seedOverrides = { final_url: EFFECTIVE_URL, redirect_count: 1, canonical_url: EFFECTIVE_URL };
    const pages: ComparisonPageRow[] = [
      page("seed-prev", PREVIOUS_RUN.id, REGISTERED_URL, seedOverrides),
      page("about-prev", PREVIOUS_RUN.id, "https://www.techtivo.com/about/"),
      page("seed-cur", LATEST_RUN.id, REGISTERED_URL, seedOverrides),
      page("about-cur", LATEST_RUN.id, "https://www.techtivo.com/about/"),
    ];
    const issues: ComparisonIssueRow[] = [
      issue(PREVIOUS_RUN.id, "seed-prev", "redirected"),
      issue(PREVIOUS_RUN.id, "seed-prev", "invalid_canonical"),
      issue(PREVIOUS_RUN.id, "about-prev", "multiple_h1"),
      issue(LATEST_RUN.id, "seed-cur", "redirected"),
      issue(LATEST_RUN.id, "seed-cur", "invalid_canonical"),
      issue(LATEST_RUN.id, "about-cur", "multiple_h1"),
    ];

    const report = buildSeoChangeReport({
      latestRun: LATEST_RUN,
      previousRun: PREVIOUS_RUN,
      pages,
      issues,
      registeredUrl: REGISTERED_URL,
    });
    if (report.status !== "compared") throw new Error("expected a compared report");

    expect(report.remaining).toEqual([
      { issueType: "multiple_h1", category: "structure", priority: "medium", label: "Multiple H1 headings", url: "https://www.techtivo.com/about/" },
    ]);
    expect(report.summary.remainingCount).toBe(1);
    expect(report.summary.newCount).toBe(0);
    expect(report.summary.resolvedCount).toBe(0);
    expect(report.summary.excludedSeedArtifactCount).toBe(4);
  });

  it("does not exclude a redirect finding on a non-seed page", () => {
    const pages: ComparisonPageRow[] = [
      page("old-prev", PREVIOUS_RUN.id, "https://example.com/old-page/", {
        final_url: "https://example.com/new-page/",
        redirect_count: 1,
      }),
      page("old-cur", LATEST_RUN.id, "https://example.com/old-page/", {
        final_url: "https://example.com/new-page/",
        redirect_count: 1,
      }),
    ];
    const issues: ComparisonIssueRow[] = [
      issue(PREVIOUS_RUN.id, "old-prev", "redirected"),
      issue(LATEST_RUN.id, "old-cur", "redirected"),
    ];

    const report = buildSeoChangeReport({
      latestRun: LATEST_RUN,
      previousRun: PREVIOUS_RUN,
      pages,
      issues,
      registeredUrl: "https://example.com/", // the seed is a different URL entirely
    });
    if (report.status !== "compared") throw new Error("expected a compared report");

    expect(report.remaining).toHaveLength(1);
    expect(report.summary.excludedSeedArtifactCount).toBe(0);
  });

  it("reproduces the exact previous behavior when registeredUrl is omitted", () => {
    const seedOverrides = { final_url: EFFECTIVE_URL, redirect_count: 1, canonical_url: EFFECTIVE_URL };
    const pages: ComparisonPageRow[] = [
      page("seed-prev", PREVIOUS_RUN.id, REGISTERED_URL, seedOverrides),
      page("seed-cur", LATEST_RUN.id, REGISTERED_URL, seedOverrides),
    ];
    const issues: ComparisonIssueRow[] = [
      issue(PREVIOUS_RUN.id, "seed-prev", "redirected"),
      issue(LATEST_RUN.id, "seed-cur", "redirected"),
    ];

    const report = compare(pages, issues);

    expect(report.remaining).toHaveLength(1);
    expect(report.summary.excludedSeedArtifactCount).toBe(0);
  });
});
