import { describe, expect, it } from "vitest";
import {
  deriveSiteHealthStatus,
  deriveSiteHealthSummary,
  deriveSiteHealthSummaryFromCounts,
} from "./siteHealthStatus";

describe("deriveSiteHealthStatus", () => {
  it("is critical when at least one high-priority issue is present", () => {
    expect(deriveSiteHealthStatus(5, 1)).toBe("critical");
  });

  it("is needs_attention when issues are present but none are high-priority", () => {
    expect(deriveSiteHealthStatus(5, 0)).toBe("needs_attention");
  });

  it("is healthy when there are zero issues", () => {
    expect(deriveSiteHealthStatus(0, 0)).toBe("healthy");
  });
});

describe("deriveSiteHealthSummaryFromCounts", () => {
  it("wraps already-computed counts (e.g. from buildSeoHealthReport's summary) using the same status rule", () => {
    // The Sites list and the site detail page both feed
    // buildSeoHealthReport's (already seed-entry-redirect-filtered)
    // summary counts through this function — it must never re-derive or
    // second-guess those counts, only decide the status label from them.
    expect(deriveSiteHealthSummaryFromCounts(35, 0)).toEqual({
      status: "needs_attention",
      totalIssues: 35,
      highPriorityIssues: 0,
    });
    expect(deriveSiteHealthSummaryFromCounts(0, 0)).toEqual({
      status: "healthy",
      totalIssues: 0,
      highPriorityIssues: 0,
    });
  });
});

describe("deriveSiteHealthSummary", () => {
  it("returns not_analyzed for null (no completed run yet)", () => {
    expect(deriveSiteHealthSummary(null)).toEqual({
      status: "not_analyzed",
      totalIssues: 0,
      highPriorityIssues: 0,
    });
  });

  it("counts a raw issue-type list directly, with no exclusion of any kind", () => {
    const result = deriveSiteHealthSummary([
      { issue_type: "http_error" }, // high priority
      { issue_type: "multiple_h1" }, // medium
      { issue_type: "missing_h1" }, // low
    ]);
    expect(result).toEqual({ status: "critical", totalIssues: 3, highPriorityIssues: 1 });
  });

  it("agrees with deriveSiteHealthSummaryFromCounts for the same underlying counts", () => {
    const issues = [{ issue_type: "multiple_h1" }, { issue_type: "meta_description_too_long" }];
    const fromIssues = deriveSiteHealthSummary(issues);
    const fromCounts = deriveSiteHealthSummaryFromCounts(
      fromIssues.totalIssues,
      fromIssues.highPriorityIssues,
    );
    expect(fromCounts).toEqual(fromIssues);
  });
});
