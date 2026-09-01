import type { CrawlIssueType } from "@/lib/crawler/analyze";

/**
 * Deterministic classification of each crawl issue type into a client-facing
 * category and priority, per CLAUDE.md's Findings Model ("Any SEO health
 * score must be explainable and derived from known rules/data rather than
 * arbitrary AI judgment"). This is a fixed lookup table, not a score — no AI,
 * no weighting.
 *
 * Priority is assigned per issue_type rather than derived from the existing
 * two-level `severity` (warning/critical), since that can't express three
 * priority levels:
 *  - High: blocks crawling/indexing outright, or removes the page's primary
 *    relevance signal (http_error, non_indexable, missing_title)
 *  - Medium: affects click-through or index consolidation but the page still
 *    indexes normally (missing_meta_description, invalid_canonical)
 *  - Low: a structural best practice with the weakest ranking impact
 *    (missing_h1)
 */
export type IssueCategory = "technical" | "metadata" | "indexability" | "structure";
export type IssuePriority = "high" | "medium" | "low";

export type IssueTaxonomyEntry = {
  category: IssueCategory;
  priority: IssuePriority;
  label: string;
  whyItMatters: string;
  recommendedAction: string;
};

export const ISSUE_TAXONOMY: Record<CrawlIssueType, IssueTaxonomyEntry> = {
  http_error: {
    category: "technical",
    priority: "high",
    label: "Page not reachable",
    whyItMatters:
      "A page that can't be fetched successfully can't be crawled or indexed by search engines, and visitors following the link hit an error.",
    recommendedAction:
      "Confirm the URL is correct and returns a successful response, or fix/remove links pointing to it.",
  },
  non_indexable: {
    category: "indexability",
    priority: "high",
    label: "Page excluded from search results",
    whyItMatters:
      "A noindex directive tells search engines not to show this page in results at all, even if it's otherwise healthy.",
    recommendedAction:
      "Confirm this page is intentionally excluded from search. If not, remove the noindex directive.",
  },
  missing_title: {
    category: "metadata",
    priority: "high",
    label: "Missing page title",
    whyItMatters:
      "The title tag is the main link text search engines show in results and one of the strongest on-page relevance signals.",
    recommendedAction: "Add a unique, descriptive <title> tag to this page.",
  },
  missing_meta_description: {
    category: "metadata",
    priority: "medium",
    label: "Missing meta description",
    whyItMatters:
      "Without a meta description, search engines auto-generate a snippet, which is often less compelling and can hurt click-through.",
    recommendedAction: "Add a concise, unique meta description that summarizes the page.",
  },
  invalid_canonical: {
    category: "indexability",
    priority: "medium",
    label: "Canonical tag problem",
    whyItMatters:
      "An empty, unparsable, or cross-domain canonical tag can cause search engines to consolidate or index the wrong version of a page.",
    recommendedAction:
      "Review this page's canonical tag and point it at the correct, intended URL.",
  },
  missing_h1: {
    category: "structure",
    priority: "low",
    label: "Missing H1 heading",
    whyItMatters:
      "The H1 heading helps both readers and search engines quickly understand the page's main topic.",
    recommendedAction: "Add a single, descriptive <h1> heading to this page.",
  },
};

export const CATEGORY_LABELS: Record<IssueCategory, string> = {
  technical: "Technical",
  metadata: "Metadata",
  indexability: "Indexability",
  structure: "Structure",
};

export const PRIORITY_LABELS: Record<IssuePriority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};
