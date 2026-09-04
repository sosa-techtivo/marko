import type { SeoHealthReport } from "./seoHealthReport";
import type { SeoChangeReport } from "./seoChangeReport";
import type { IssueCategory } from "./issueTaxonomy";

/**
 * Short, deterministic client-facing narrative sentences derived only from
 * SeoHealthReport/SeoChangeReport — the exact same computed data the rest
 * of the report already renders as numbers. No AI, no external calls, no
 * causal/traffic/ranking claims: every clause is a direct restatement of an
 * existing count. Pure and independently testable, per CLAUDE.md's AI Usage
 * Principles ("Use deterministic code when the answer is deterministic").
 */

/** Human, client-facing phrasing for each issue category, used only to
 * compose the Executive Summary's "main opportunities are related to..."
 * clause — a fixed lookup (like CATEGORY_LABELS), not a generated phrase. */
const NARRATIVE_CATEGORY_PHRASES: Record<IssueCategory, string> = {
  technical: "technical site health",
  metadata: "search-result metadata",
  indexability: "search indexability",
  structure: "page structure",
};

function pluralize(count: number, singular: string, plural: string = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function joinWithAnd(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * "What is the current SEO situation?" — the Executive Summary's narrative
 * paragraph. Returns null when there's no completed analysis to describe
 * (the caller already shows its own "no analysis yet" empty state).
 */
export function buildExecutiveNarrative(health: SeoHealthReport | null, siteName: string): string | null {
  if (!health) return null;

  const { pagesAnalyzed, highPriorityIssues, totalIssues } = health.summary;

  const sentences: string[] = [
    `MARKO analyzed ${pagesAnalyzed} ${pluralize(pagesAnalyzed, "page")} across ${siteName}'s website.`,
  ];

  if (totalIssues === 0) {
    sentences.push("No SEO issues were detected in this analysis.");
  } else if (highPriorityIssues === 0) {
    sentences.push(
      `No high-priority SEO issues were detected, but ${totalIssues} optimization ` +
        `${pluralize(totalIssues, "opportunity", "opportunities")} remain.`,
    );
  } else {
    sentences.push(
      `${highPriorityIssues} high-priority ${pluralize(highPriorityIssues, "issue")} ` +
        `${highPriorityIssues === 1 ? "requires" : "require"} attention, alongside ${totalIssues} total ` +
        `optimization ${pluralize(totalIssues, "opportunity", "opportunities")}.`,
    );
  }

  if (health.opportunities.length > 0) {
    const affectedPagesByCategory = new Map<IssueCategory, number>();
    for (const opportunity of health.opportunities) {
      affectedPagesByCategory.set(
        opportunity.category,
        (affectedPagesByCategory.get(opportunity.category) ?? 0) + opportunity.affectedPages.length,
      );
    }
    const topCategories = [...affectedPagesByCategory.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 2)
      .map(([category]) => NARRATIVE_CATEGORY_PHRASES[category]);

    sentences.push(`The main opportunities are related to ${joinWithAnd(topCategories)}.`);
  }

  return sentences.join(" ");
}

/**
 * "Is SEO improving over time?" — the SEO Progress section's narrative
 * sentence. Only meaningful once there's a previous analysis to compare
 * against; returns null for `{status: "no-previous-run"}`; the caller
 * already shows its own "first analysis" empty state in that case. Never
 * claims improvement beyond what resolved/new counts actually support, and
 * never infers a cause for any change (per CLAUDE.md: no causal SEO/traffic
 * claims).
 */
export function buildProgressNarrative(changeReport: SeoChangeReport): string | null {
  if (changeReport.status !== "compared") return null;

  const { resolvedCount, newCount } = changeReport.summary;
  if (resolvedCount === 0 && newCount === 0) {
    return "No material SEO changes were detected since the previous comparable analysis.";
  }

  const newHighPriorityCount = changeReport.newIssues.filter((issue) => issue.priority === "high").length;
  const clauses: string[] = [];

  if (resolvedCount > 0) {
    clauses.push(
      `${resolvedCount} optimization ${pluralize(resolvedCount, "opportunity", "opportunities")} ` +
        `${resolvedCount === 1 ? "was" : "were"} resolved since the previous analysis`,
    );
  }

  if (newCount === 0) {
    clauses.push(resolvedCount > 0 ? "no new issues were introduced" : "no new issues were introduced since the previous analysis");
  } else if (newHighPriorityCount > 0) {
    clauses.push(
      `${newHighPriorityCount} new high-priority ${pluralize(newHighPriorityCount, "issue")} ` +
        `${newHighPriorityCount === 1 ? "was" : "were"} identified`,
    );
  } else {
    clauses.push(
      `${newCount} new ${pluralize(newCount, "issue")} ${newCount === 1 ? "was" : "were"} identified, none high-priority`,
    );
  }

  const sentence = clauses.join(", ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
