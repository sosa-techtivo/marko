import { describe, expect, it } from "vitest";
import { buildExecutiveNarrative, buildProgressNarrative } from "./narrative";
import { buildSeoHealthReport, type CrawlIssueRow, type CrawlPageRow } from "./seoHealthReport";
import { buildSeoChangeReport, type ComparisonIssueRow, type ComparisonPageRow } from "./seoChangeReport";

function page(id: string, url: string): CrawlPageRow {
  return {
    id,
    url,
    http_status: 200,
    title: "A Title",
    meta_description: "A description that is long enough to pass the length checks easily.",
    h1: "Heading",
    canonical_url: url,
    is_indexable: true,
  };
}

function issue(id: string, pageId: string, issueType: string): CrawlIssueRow {
  return { id, crawl_page_id: pageId, issue_type: issueType, message: "A finding." };
}

describe("buildExecutiveNarrative", () => {
  it("returns null when there's no completed analysis", () => {
    expect(buildExecutiveNarrative(null, "Techtivo")).toBeNull();
  });

  it("states zero issues plainly when there are none", () => {
    const health = buildSeoHealthReport([page("a", "https://example.com/")], [], "https://example.com/");
    const narrative = buildExecutiveNarrative(health, "Techtivo");

    expect(narrative).toContain("MARKO analyzed 1 page across Techtivo's website.");
    expect(narrative).toContain("No SEO issues were detected in this analysis.");
    expect(narrative).not.toContain("main opportunities");
  });

  it("reports 'no high-priority' plus a total when only lower-priority issues exist, with the top categories named", () => {
    const pages = [page("a", "https://example.com/a"), page("b", "https://example.com/b")];
    const issues = [
      issue("i1", "a", "multiple_h1"),
      issue("i2", "b", "multiple_h1"),
      issue("i3", "a", "meta_description_too_long"),
    ];
    const health = buildSeoHealthReport(pages, issues);
    const narrative = buildExecutiveNarrative(health, "Techtivo");

    expect(narrative).toContain("MARKO analyzed 2 pages across Techtivo's website.");
    expect(narrative).toContain("No high-priority SEO issues were detected, but 3 optimization opportunities remain.");
    // multiple_h1 (structure) affects 2 pages, meta_description_too_long (metadata) affects 1 — structure ranks first.
    expect(narrative).toContain("The main opportunities are related to page structure and search-result metadata.");
  });

  it("leads with high-priority issue count when present", () => {
    const health = buildSeoHealthReport(
      [page("a", "https://example.com/a")],
      [issue("i1", "a", "missing_title")],
    );
    const narrative = buildExecutiveNarrative(health, "Techtivo");

    expect(narrative).toContain("1 high-priority issue requires attention, alongside 1 total optimization opportunity.");
  });

  it("never mentions Search Console, traffic, rankings, or causality", () => {
    const health = buildSeoHealthReport(
      [page("a", "https://example.com/a")],
      [issue("i1", "a", "missing_title")],
    );
    const narrative = buildExecutiveNarrative(health, "Techtivo") ?? "";

    for (const forbidden of ["traffic", "ranking", "click", "impression", "caused", "because"]) {
      expect(narrative.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe("buildProgressNarrative", () => {
  it("returns null when there's no previous analysis to compare against", () => {
    expect(buildProgressNarrative({ status: "no-previous-run", latestRun: { id: "r1", startedAt: "2026-09-01T00:00:00Z" } })).toBeNull();
  });

  const LATEST_RUN = { id: "run-latest", startedAt: "2026-09-04T00:00:00.000Z" };
  const PREVIOUS_RUN = { id: "run-previous", startedAt: "2026-09-01T00:00:00.000Z" };

  function comparisonPage(id: string, runId: string, url: string): ComparisonPageRow {
    return { id, crawl_run_id: runId, url, http_status: 200, fetch_error: null };
  }
  function comparisonIssue(runId: string, pageId: string, issueType: string): ComparisonIssueRow {
    return { crawl_run_id: runId, crawl_page_id: pageId, issue_type: issueType };
  }

  it("states no material change when nothing was resolved or introduced", () => {
    const pages = [comparisonPage("a1", PREVIOUS_RUN.id, "https://example.com/a"), comparisonPage("a2", LATEST_RUN.id, "https://example.com/a")];
    const report = buildSeoChangeReport({ latestRun: LATEST_RUN, previousRun: PREVIOUS_RUN, pages, issues: [] });

    expect(buildProgressNarrative(report)).toBe("No material SEO changes were detected since the previous comparable analysis.");
  });

  it("reports resolved issues with no new ones", () => {
    const pages = [comparisonPage("a1", PREVIOUS_RUN.id, "https://example.com/a"), comparisonPage("a2", LATEST_RUN.id, "https://example.com/a")];
    const issues = [comparisonIssue(PREVIOUS_RUN.id, "a1", "missing_title")];
    const report = buildSeoChangeReport({ latestRun: LATEST_RUN, previousRun: PREVIOUS_RUN, pages, issues });

    expect(buildProgressNarrative(report)).toBe(
      "1 optimization opportunity was resolved since the previous analysis, no new issues were introduced.",
    );
  });

  it("calls out new high-priority issues specifically", () => {
    const pages = [comparisonPage("a1", PREVIOUS_RUN.id, "https://example.com/a"), comparisonPage("a2", LATEST_RUN.id, "https://example.com/a")];
    const issues = [comparisonIssue(LATEST_RUN.id, "a2", "missing_title")];
    const report = buildSeoChangeReport({ latestRun: LATEST_RUN, previousRun: PREVIOUS_RUN, pages, issues });

    expect(buildProgressNarrative(report)).toBe("1 new high-priority issue was identified.");
  });

  it("notes new non-high-priority issues without alarming high-priority language", () => {
    const pages = [comparisonPage("a1", PREVIOUS_RUN.id, "https://example.com/a"), comparisonPage("a2", LATEST_RUN.id, "https://example.com/a")];
    const issues = [comparisonIssue(LATEST_RUN.id, "a2", "multiple_h1")];
    const report = buildSeoChangeReport({ latestRun: LATEST_RUN, previousRun: PREVIOUS_RUN, pages, issues });

    expect(buildProgressNarrative(report)).toBe("1 new issue was identified, none high-priority.");
  });

  it("never claims improvement beyond resolved/new counts (no causal language)", () => {
    const pages = [comparisonPage("a1", PREVIOUS_RUN.id, "https://example.com/a"), comparisonPage("a2", LATEST_RUN.id, "https://example.com/a")];
    const issues = [comparisonIssue(PREVIOUS_RUN.id, "a1", "missing_title")];
    const report = buildSeoChangeReport({ latestRun: LATEST_RUN, previousRun: PREVIOUS_RUN, pages, issues });
    const narrative = buildProgressNarrative(report)?.toLowerCase() ?? "";

    for (const forbidden of ["improv", "traffic", "ranking", "because", "caused"]) {
      expect(narrative).not.toContain(forbidden);
    }
  });
});
