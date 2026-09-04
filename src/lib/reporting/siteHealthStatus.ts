import type { CrawlIssueType } from "@/lib/crawler/analyze";
import { ISSUE_TAXONOMY } from "./issueTaxonomy";

/**
 * Coarse, categorical health status for a site's dashboard card. Derived
 * from the latest completed crawl's issues, reusing `ISSUE_TAXONOMY` — the
 * same priority classification the SEO report itself uses — rather than a
 * new scoring rule. Deliberately not a numeric score: four semantic
 * buckets only, matching CLAUDE.md's Findings Model ("Any SEO health score
 * must be explainable and derived from known rules/data").
 */
export type SiteHealthStatus = "healthy" | "needs_attention" | "critical" | "not_analyzed";

export type SiteHealthSummary = {
  status: SiteHealthStatus;
  totalIssues: number;
  highPriorityIssues: number;
};

export const SITE_HEALTH_STATUS_LABELS: Record<SiteHealthStatus, string> = {
  healthy: "Healthy",
  needs_attention: "Needs attention",
  critical: "Critical",
  not_analyzed: "Not analyzed",
};

function isKnownIssueType(type: string): type is CrawlIssueType {
  return Object.prototype.hasOwnProperty.call(ISSUE_TAXONOMY, type);
}

/**
 * The one place "critical vs. needs attention vs. healthy" is decided,
 * given final total/high-priority counts — shared by every caller that
 * already has those counts, however they were computed (a raw list of
 * issue rows, or `buildSeoHealthReport`'s already-filtered summary; see
 * `deriveSiteHealthSummaryFromCounts` below). Never reimplemented
 * per-caller, so a definition of "critical" only ever needs to change in
 * one place.
 *
 *  - Critical: at least one High-priority issue present.
 *  - Needs attention: issues present, but none High-priority.
 *  - Healthy: zero issues.
 */
export function deriveSiteHealthStatus(
  totalIssues: number,
  highPriorityIssues: number,
): Exclude<SiteHealthStatus, "not_analyzed"> {
  return highPriorityIssues > 0 ? "critical" : totalIssues > 0 ? "needs_attention" : "healthy";
}

/** Same status rule as `deriveSiteHealthSummary`, for a caller that
 * already has final counts (e.g. from `buildSeoHealthReport`'s summary,
 * which has already applied its own seed-entry-redirect exclusion) rather
 * than a raw list of issue rows to count itself — so that exclusion is
 * never redone or bypassed by a second, independent counting pass here. */
export function deriveSiteHealthSummaryFromCounts(
  totalIssues: number,
  highPriorityIssues: number,
): SiteHealthSummary {
  return { status: deriveSiteHealthStatus(totalIssues, highPriorityIssues), totalIssues, highPriorityIssues };
}

/**
 * `issues` is every issue row from the site's latest *completed* crawl
 * run; pass `null` when no completed run exists yet (→ "not_analyzed").
 * Counts `issues` itself, with no exclusion of any kind — only appropriate
 * when the caller doesn't need `buildSeoHealthReport`'s seed-entry-
 * redirect exclusion (e.g. a historical run's raw issue-type list for the
 * SEO progress trend). A caller that already has final, correctly-filtered
 * counts should use `deriveSiteHealthSummaryFromCounts` instead.
 */
export function deriveSiteHealthSummary(
  issues: { issue_type: string }[] | null,
): SiteHealthSummary {
  if (issues === null) {
    return { status: "not_analyzed", totalIssues: 0, highPriorityIssues: 0 };
  }

  const highPriorityIssues = issues.filter(
    (issue) => isKnownIssueType(issue.issue_type) && ISSUE_TAXONOMY[issue.issue_type].priority === "high",
  ).length;
  const totalIssues = issues.length;

  return deriveSiteHealthSummaryFromCounts(totalIssues, highPriorityIssues);
}
