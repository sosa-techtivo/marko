import { describe, expect, it } from "vitest";
import { buildMarkoInsights } from "./markoInsights";
import { buildSeoHealthReport, type CrawlIssueRow, type CrawlPageRow } from "./seoHealthReport";
import {
  buildSeoChangeReport,
  type ComparisonIssueRow,
  type ComparisonPageRow,
  type SeoChangeReport,
} from "./seoChangeReport";

const PREVIOUS_RUN = { id: "run-previous", startedAt: "2026-08-01T00:00:00.000Z" };
const LATEST_RUN = { id: "run-latest", startedAt: "2026-08-15T00:00:00.000Z" };

const NO_PREVIOUS: SeoChangeReport = { status: "no-previous-run", latestRun: LATEST_RUN };

function cleanPage(id: string, url: string): CrawlPageRow {
  return {
    id,
    url,
    http_status: 200,
    title: "A perfectly fine title",
    meta_description: "A perfectly fine meta description, long enough to pass every check.",
    h1: "Heading",
    canonical_url: url,
    is_indexable: true,
  };
}

function crawlIssue(id: string, pageId: string, issueType: string): CrawlIssueRow {
  return { id, crawl_page_id: pageId, issue_type: issueType, message: "test" };
}

function health(pages: CrawlPageRow[], issues: CrawlIssueRow[]) {
  return buildSeoHealthReport(pages, issues);
}

function comparisonPage(
  id: string,
  runId: string,
  url: string,
  overrides: Partial<ComparisonPageRow> = {},
): ComparisonPageRow {
  return { id, crawl_run_id: runId, url, http_status: 200, fetch_error: null, ...overrides };
}

function comparisonIssue(runId: string, pageId: string, issueType: string): ComparisonIssueRow {
  return { crawl_run_id: runId, crawl_page_id: pageId, issue_type: issueType };
}

function compare(pages: ComparisonPageRow[], issues: ComparisonIssueRow[]): SeoChangeReport {
  return buildSeoChangeReport({ latestRun: LATEST_RUN, previousRun: PREVIOUS_RUN, pages, issues });
}

describe("buildMarkoInsights — PRIORITY", () => {
  it("surfaces the single highest-priority current finding", () => {
    const pages = [1, 2, 3, 4].map((n) => cleanPage(`p${n}`, `https://example.com/${n}`));
    const issues = [
      crawlIssue("i1", "p1", "http_error"), // high priority, 1/4 = 25%
      crawlIssue("i2", "p2", "missing_h1"), // low priority, 1/4 = 25%
    ];

    const insights = buildMarkoInsights(health(pages, issues), NO_PREVIOUS);

    expect(insights).toHaveLength(1);
    expect(insights[0]).toMatchObject({
      id: "priority:http_error",
      type: "priority",
      priority: "high",
      affectedPageCount: 1,
    });
  });
});

describe("buildMarkoInsights — COVERAGE / prevalence", () => {
  it("surfaces a widespread issue distinct from the priority pick", () => {
    const pages = [1, 2, 3, 4, 5].map((n) => cleanPage(`p${n}`, `https://example.com/${n}`));
    const issues = [
      crawlIssue("i1", "p1", "http_error"), // high priority, 1/5 = 20% → priority pick
      crawlIssue("i2", "p2", "multiple_h1"),
      crawlIssue("i3", "p3", "multiple_h1"),
      crawlIssue("i4", "p4", "multiple_h1"),
      crawlIssue("i5", "p5", "multiple_h1"), // medium priority, 4/5 = 80% → coverage
    ];

    const insights = buildMarkoInsights(health(pages, issues), NO_PREVIOUS);

    expect(insights.map((i) => i.id)).toEqual(["priority:http_error", "coverage:multiple_h1"]);
    const coverage = insights.find((i) => i.id === "coverage:multiple_h1")!;
    expect(coverage.title).toBe("Multiple H1 headings is widespread");
    expect(coverage.affectedPageCount).toBe(4);
    expect(coverage.explanation).toContain("4 of 5 analyzed pages (80%)");
  });

  it("does not surface an issue below the prevalence threshold", () => {
    const pages = [1, 2, 3, 4, 5].map((n) => cleanPage(`p${n}`, `https://example.com/${n}`));
    const issues = [
      crawlIssue("i1", "p1", "http_error"), // high priority, 1/5 → priority pick
      crawlIssue("i2", "p2", "missing_canonical"),
      crawlIssue("i3", "p3", "missing_canonical"), // low priority, 2/5 = 40% < 50% threshold
    ];

    const insights = buildMarkoInsights(health(pages, issues), NO_PREVIOUS);

    expect(insights).toHaveLength(1);
    expect(insights[0].id).toBe("priority:http_error");
  });
});

describe("buildMarkoInsights — deduplication", () => {
  it("does not surface the same issue as both PRIORITY and COVERAGE", () => {
    const pages = [1, 2, 3, 4, 5].map((n) => cleanPage(`p${n}`, `https://example.com/${n}`));
    const issues = [1, 2, 3, 4].map((n) => crawlIssue(`i${n}`, `p${n}`, "missing_title")); // 4/5 = 80%

    const insights = buildMarkoInsights(health(pages, issues), NO_PREVIOUS);

    expect(insights).toHaveLength(1);
    expect(insights[0]).toMatchObject({ id: "priority:missing_title", affectedPageCount: 4 });
  });
});

describe("buildMarkoInsights — RECENT CHANGE", () => {
  it("surfaces resolved issues", () => {
    const previousPages = [comparisonPage("prev-1", PREVIOUS_RUN.id, "https://example.com/a")];
    const latestPages = [comparisonPage("cur-1", LATEST_RUN.id, "https://example.com/a")];
    const changeReport = compare(
      [...previousPages, ...latestPages],
      [comparisonIssue(PREVIOUS_RUN.id, "prev-1", "missing_title")],
    );

    const currentPages = [cleanPage("cur-1", "https://example.com/a")]; // no current issues
    const insights = buildMarkoInsights(health(currentPages, []), changeReport);

    expect(insights).toHaveLength(1);
    expect(insights[0]).toMatchObject({
      id: "recent_change:resolved",
      type: "recent_change",
      hasAffectedPages: false,
      affectedPageCount: 1,
    });
    expect(insights[0].title).toBe("1 issue resolved");
  });

  it("surfaces genuinely new issues, excluding findings on newly-analyzed pages", () => {
    // A steady-state issue (non_indexable, present in both runs on two
    // pages) is the clear PRIORITY pick here — deliberately distinct from
    // the "new" issue type below, so this test isolates the
    // newly-analyzed-page protection from the new-issue-vs-PRIORITY
    // deduplication covered separately below.
    const previousPages = [
      comparisonPage("prev-a", PREVIOUS_RUN.id, "https://example.com/a"),
      comparisonPage("prev-c", PREVIOUS_RUN.id, "https://example.com/c"),
      comparisonPage("prev-d", PREVIOUS_RUN.id, "https://example.com/d"),
    ];
    const latestPages = [
      comparisonPage("cur-a", LATEST_RUN.id, "https://example.com/a"),
      // Never crawled before — a newly-analyzed page, not a regression.
      comparisonPage("cur-b", LATEST_RUN.id, "https://example.com/b"),
      comparisonPage("cur-c", LATEST_RUN.id, "https://example.com/c"),
      comparisonPage("cur-d", LATEST_RUN.id, "https://example.com/d"),
    ];
    const changeReport = compare(
      [...previousPages, ...latestPages],
      [
        comparisonIssue(PREVIOUS_RUN.id, "prev-c", "non_indexable"),
        comparisonIssue(PREVIOUS_RUN.id, "prev-d", "non_indexable"),
        comparisonIssue(LATEST_RUN.id, "cur-c", "non_indexable"), // remaining, not new
        comparisonIssue(LATEST_RUN.id, "cur-d", "non_indexable"), // remaining, not new
        comparisonIssue(LATEST_RUN.id, "cur-a", "missing_title"), // genuine new issue
        comparisonIssue(LATEST_RUN.id, "cur-b", "missing_h1"), // newly-analyzed page finding
      ],
    );
    if (changeReport.status !== "compared") throw new Error("expected a compared report");
    expect(changeReport.summary.newCount).toBe(1);
    expect(changeReport.summary.newlyAnalyzedPageCount).toBe(1);

    const currentPages = [
      cleanPage("cur-a", "https://example.com/a"),
      cleanPage("cur-b", "https://example.com/b"),
      cleanPage("cur-c", "https://example.com/c"),
      cleanPage("cur-d", "https://example.com/d"),
    ];
    const currentIssues = [
      crawlIssue("ci1", "cur-a", "missing_title"),
      crawlIssue("ci2", "cur-b", "missing_h1"),
      crawlIssue("ci3", "cur-c", "non_indexable"),
      crawlIssue("ci4", "cur-d", "non_indexable"),
    ];
    const insights = buildMarkoInsights(health(currentPages, currentIssues), changeReport);

    expect(insights.map((i) => i.id)).toContain("priority:non_indexable");

    const newInsight = insights.find((i) => i.id === "recent_change:new");
    expect(newInsight).toBeDefined();
    expect(newInsight!.affectedPageCount).toBe(1);
    expect(newInsight!.explanation).toContain("Missing page title on https://example.com/a");
    expect(newInsight!.explanation).not.toContain("Missing H1 heading");
  });

  it("does not surface a 'new issues' insight when every new issue's type is already covered by a higher-ranked insight", () => {
    // The only new issue shares its type with the widespread COVERAGE
    // pick (which already includes this exact page in its count) — citing
    // it again as "new" would add nothing not already said.
    const previousPages = [comparisonPage("prev-1", PREVIOUS_RUN.id, "https://example.com/1")];
    const latestPages = [1, 2, 3, 4, 5].map((n) =>
      comparisonPage(`cur-${n}`, LATEST_RUN.id, `https://example.com/${n}`),
    );
    const changeReport = compare(
      [...previousPages, ...latestPages],
      // Only cur-1 is comparable to the previous run; it didn't have
      // images_missing_alt before, so that's the one genuine "new" entry.
      [2, 3, 4, 5].map((n) => comparisonIssue(LATEST_RUN.id, `cur-${n}`, "images_missing_alt")).concat([
        comparisonIssue(LATEST_RUN.id, "cur-1", "images_missing_alt"),
      ]),
    );
    if (changeReport.status !== "compared") throw new Error("expected a compared report");
    expect(changeReport.summary.newCount).toBe(1);

    const currentPages = [1, 2, 3, 4, 5].map((n) => cleanPage(`cur-${n}`, `https://example.com/${n}`));
    // images_missing_alt affects all 5 (100%) — it becomes the PRIORITY
    // pick since it's the only current issue type at all.
    const currentIssues = [1, 2, 3, 4, 5].map((n) => crawlIssue(`i${n}`, `cur-${n}`, "images_missing_alt"));
    const insights = buildMarkoInsights(health(currentPages, currentIssues), changeReport);

    expect(insights.map((i) => i.id)).toEqual(["priority:images_missing_alt"]);
    expect(insights.map((i) => i.id)).not.toContain("recent_change:new");
  });

  it("picks a non-redundant representative for 'new issues' when some, but not all, new issues overlap an already-used type", () => {
    const previousPages = [comparisonPage("prev-1", PREVIOUS_RUN.id, "https://example.com/1")];
    const latestPages = [comparisonPage("cur-1", LATEST_RUN.id, "https://example.com/1")];
    const changeReport = compare(
      [...previousPages, ...latestPages],
      [
        comparisonIssue(LATEST_RUN.id, "cur-1", "http_error"), // same type as PRIORITY pick
        comparisonIssue(LATEST_RUN.id, "cur-1", "title_too_long"), // distinct, non-redundant
      ],
    );
    if (changeReport.status !== "compared") throw new Error("expected a compared report");
    expect(changeReport.summary.newCount).toBe(2);

    const currentPages = [cleanPage("cur-1", "https://example.com/1")];
    const currentIssues = [
      crawlIssue("i1", "cur-1", "http_error"),
      crawlIssue("i2", "cur-1", "title_too_long"),
    ];
    const insights = buildMarkoInsights(health(currentPages, currentIssues), changeReport);

    const newInsight = insights.find((i) => i.id === "recent_change:new");
    expect(newInsight).toBeDefined();
    // The full count is still reported accurately...
    expect(newInsight!.affectedPageCount).toBe(2);
    // ...but the example cited is the one not already claimed by PRIORITY.
    expect(newInsight!.explanation).toContain("Title too long");
    expect(newInsight!.explanation).not.toContain("Page not reachable");
  });

  it("surfaces a persistently widespread issue as 'remains widespread'", () => {
    const previousPages = [1, 2, 3, 4].map((n) =>
      comparisonPage(`prev-${n}`, PREVIOUS_RUN.id, `https://example.com/${n}`),
    );
    const latestPages = [1, 2, 3, 4].map((n) =>
      comparisonPage(`cur-${n}`, LATEST_RUN.id, `https://example.com/${n}`),
    );
    // 3 of 4 pages have the same issue in both the previous and latest run.
    const changeIssues = [1, 2, 3].flatMap((n) => [
      comparisonIssue(PREVIOUS_RUN.id, `prev-${n}`, "images_missing_alt"),
      comparisonIssue(LATEST_RUN.id, `cur-${n}`, "images_missing_alt"),
    ]);
    const changeReport = compare([...previousPages, ...latestPages], changeIssues);
    if (changeReport.status !== "compared") throw new Error("expected a compared report");
    expect(changeReport.remaining).toHaveLength(3);

    // A different, unrelated top-priority issue on the current run so the
    // remaining-widespread pick isn't also claimed by PRIORITY/COVERAGE.
    const currentPages = [1, 2, 3, 4].map((n) => cleanPage(`cur-${n}`, `https://example.com/${n}`));
    const currentIssues = [
      crawlIssue("hi1", "cur-4", "http_error"),
      ...[1, 2, 3].map((n) => crawlIssue(`ai${n}`, `cur-${n}`, "images_missing_alt")),
    ];
    const insights = buildMarkoInsights(health(currentPages, currentIssues), changeReport);

    const remainingInsight = insights.find((i) => i.id === "recent_change:remaining:images_missing_alt");
    expect(remainingInsight).toBeDefined();
    expect(remainingInsight!.affectedPageCount).toBe(3);
    expect(remainingInsight!.explanation).toContain("3 of 4 analyzed pages (75%)");
  });

  it("does not duplicate a remaining-widespread issue already claimed by PRIORITY", () => {
    const previousPages = [1, 2, 3].map((n) =>
      comparisonPage(`prev-${n}`, PREVIOUS_RUN.id, `https://example.com/${n}`),
    );
    const latestPages = [1, 2, 3].map((n) =>
      comparisonPage(`cur-${n}`, LATEST_RUN.id, `https://example.com/${n}`),
    );
    const changeIssues = [1, 2, 3].flatMap((n) => [
      comparisonIssue(PREVIOUS_RUN.id, `prev-${n}`, "missing_h1"),
      comparisonIssue(LATEST_RUN.id, `cur-${n}`, "missing_h1"),
    ]);
    const changeReport = compare([...previousPages, ...latestPages], changeIssues);

    const currentPages = [1, 2, 3].map((n) => cleanPage(`cur-${n}`, `https://example.com/${n}`));
    const currentIssues = [1, 2, 3].map((n) => crawlIssue(`i${n}`, `cur-${n}`, "missing_h1"));
    const insights = buildMarkoInsights(health(currentPages, currentIssues), changeReport);

    expect(insights.filter((i) => i.id.startsWith("recent_change:remaining"))).toHaveLength(0);
    expect(insights.map((i) => i.id)).toContain("priority:missing_h1");
  });
});

describe("buildMarkoInsights — ranking", () => {
  it("ranks by priority first, then by affected-page count, deterministically", () => {
    const pages = Array.from({ length: 10 }, (_, i) => cleanPage(`p${i}`, `https://example.com/${i}`));
    const issues = [
      ...Array.from({ length: 6 }, (_, i) => crawlIssue(`h${i}`, `p${i}`, "http_error")), // high, 60%
      ...Array.from({ length: 8 }, (_, i) => crawlIssue(`m${i}`, `p${i}`, "multiple_h1")), // medium, 80%
      ...Array.from({ length: 5 }, (_, i) => crawlIssue(`l${i}`, `p${i}`, "images_missing_alt")), // low, 50%
    ];

    const insights = buildMarkoInsights(health(pages, issues), NO_PREVIOUS);

    expect(insights.map((i) => i.id)).toEqual([
      "priority:http_error",
      "coverage:multiple_h1",
      "coverage:images_missing_alt",
    ]);
  });

  it("never returns more than 5 insights, dropping the lowest-ranked candidates", () => {
    const pages = Array.from({ length: 10 }, (_, i) => cleanPage(`p${i}`, `https://example.com/${i}`));
    // 6 distinct issue types, each still ≥50% prevalent, with decreasing
    // priority/count so there's an unambiguous lowest-ranked candidate.
    const issueSpecs: [string, number][] = [
      ["http_error", 10], // high
      ["non_indexable", 9], // high
      ["missing_title", 8], // high
      ["multiple_h1", 7], // medium
      ["invalid_canonical", 6], // medium
      ["images_missing_alt", 5], // low — should be dropped by the cap
    ];
    const issues = issueSpecs.flatMap(([type, count]) =>
      Array.from({ length: count }, (_, i) => crawlIssue(`${type}-${i}`, `p${i}`, type)),
    );

    const insights = buildMarkoInsights(health(pages, issues), NO_PREVIOUS);

    expect(insights).toHaveLength(5);
    expect(insights.map((i) => i.id)).not.toContain("coverage:images_missing_alt");
  });
});

describe("buildMarkoInsights — empty state", () => {
  it("returns no insights when there are no current issues and no previous analysis", () => {
    const pages = [cleanPage("p1", "https://example.com/1")];

    const insights = buildMarkoInsights(health(pages, []), NO_PREVIOUS);

    expect(insights).toEqual([]);
  });

  it("returns no insights when the latest analysis is clean and nothing changed since the previous one", () => {
    const previousPages = [comparisonPage("prev-1", PREVIOUS_RUN.id, "https://example.com/a")];
    const latestPages = [comparisonPage("cur-1", LATEST_RUN.id, "https://example.com/a")];
    const changeReport = compare([...previousPages, ...latestPages], []);

    const currentPages = [cleanPage("cur-1", "https://example.com/a")];
    const insights = buildMarkoInsights(health(currentPages, []), changeReport);

    expect(insights).toEqual([]);
  });
});
