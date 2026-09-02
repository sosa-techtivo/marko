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
 * `issues` is every issue row from the site's latest *completed* crawl
 * run; pass `null` when no completed run exists yet (→ "not_analyzed").
 *
 *  - Critical: at least one High-priority issue present.
 *  - Needs attention: issues present, but none High-priority.
 *  - Healthy: zero issues.
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

  const status: SiteHealthStatus =
    highPriorityIssues > 0 ? "critical" : totalIssues > 0 ? "needs_attention" : "healthy";

  return { status, totalIssues, highPriorityIssues };
}
