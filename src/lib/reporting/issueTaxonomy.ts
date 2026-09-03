import type { CrawlIssueType } from "@/lib/crawler/analyze";
import {
  META_DESCRIPTION_MAX_LENGTH,
  META_DESCRIPTION_MIN_LENGTH,
  TITLE_MAX_LENGTH,
  TITLE_MIN_LENGTH,
} from "@/lib/crawler/seoRules";

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
 *  - Medium: affects click-through, distinctiveness, or index consolidation
 *    but the page still indexes normally (missing_meta_description,
 *    invalid_canonical, title_too_short/too_long, duplicate_title,
 *    duplicate_meta_description, multiple_h1, duplicate_canonical,
 *    canonical_chain)
 *  - Low: a structural best practice with the weakest ranking impact
 *    (missing_h1, meta_description_too_short/too_long, missing_canonical,
 *    images_missing_alt, invalid_structured_data)
 *
 * `duplicate_canonical`'s and `canonical_chain`'s priority (Medium) aren't
 * from an explicit external spec — both are inferred as the same tier as
 * `invalid_canonical`, since all three are canonical-correctness problems
 * more consequential than a single missing canonical tag (Low).
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
  title_too_short: {
    category: "metadata",
    priority: "medium",
    label: "Title too short",
    whyItMatters:
      "A very short title may not give search engines or searchers enough context about what this page covers.",
    recommendedAction: `Expand the title to roughly ${TITLE_MIN_LENGTH}–${TITLE_MAX_LENGTH} characters while staying accurate to the page's content.`,
  },
  title_too_long: {
    category: "metadata",
    priority: "medium",
    label: "Title too long",
    whyItMatters: "A very long title is often truncated in search results, hiding part of it.",
    recommendedAction: `Shorten the title to roughly ${TITLE_MIN_LENGTH}–${TITLE_MAX_LENGTH} characters, keeping the most important words near the front.`,
  },
  duplicate_title: {
    category: "metadata",
    priority: "medium",
    label: "Duplicate title",
    whyItMatters:
      "Identical titles make it harder for search engines, and searchers, to distinguish between these pages.",
    recommendedAction: "Write a unique, descriptive title for each page.",
  },
  missing_meta_description: {
    category: "metadata",
    priority: "medium",
    label: "Missing meta description",
    whyItMatters:
      "Without a meta description, search engines auto-generate a snippet, which is often less compelling and can hurt click-through.",
    recommendedAction: "Add a concise, unique meta description that summarizes the page.",
  },
  meta_description_too_short: {
    category: "metadata",
    priority: "low",
    label: "Meta description too short",
    whyItMatters:
      "A very short meta description gives search engines little to work with when generating a results snippet.",
    recommendedAction: `Expand the meta description to roughly ${META_DESCRIPTION_MIN_LENGTH}–${META_DESCRIPTION_MAX_LENGTH} characters.`,
  },
  meta_description_too_long: {
    category: "metadata",
    priority: "low",
    label: "Meta description too long",
    whyItMatters: "A very long meta description is often truncated in search results.",
    recommendedAction: `Shorten the meta description to roughly ${META_DESCRIPTION_MIN_LENGTH}–${META_DESCRIPTION_MAX_LENGTH} characters.`,
  },
  duplicate_meta_description: {
    category: "metadata",
    priority: "medium",
    label: "Duplicate meta description",
    whyItMatters:
      "Identical meta descriptions reduce the ability to give each page's search snippet distinct, relevant text.",
    recommendedAction: "Write a unique meta description for each page.",
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
  missing_canonical: {
    category: "indexability",
    priority: "low",
    label: "Missing canonical tag",
    whyItMatters:
      "Without a canonical tag, search engines must infer the authoritative URL themselves, which matters if this page is reachable through more than one URL.",
    recommendedAction: "Add a self-referencing canonical tag to this page.",
  },
  duplicate_canonical: {
    category: "indexability",
    priority: "medium",
    label: "Unexpected canonical consolidation",
    whyItMatters:
      "Multiple, otherwise-distinct pages declaring the same canonical target can unexpectedly consolidate them in search results, which may not be intended.",
    recommendedAction:
      "Confirm this consolidation is intentional; if these pages should be indexed separately, correct their canonical tags.",
  },
  canonical_chain: {
    category: "indexability",
    priority: "medium",
    label: "Canonical chain",
    whyItMatters:
      "This page's canonical points to another page that doesn't canonicalize to itself, instead deferring further. Search engines aren't guaranteed to follow a chain of canonicals to wherever it actually ends.",
    recommendedAction:
      "Point this page's canonical directly at the final, self-referencing target instead of at an intermediate page.",
  },
  missing_h1: {
    category: "structure",
    priority: "low",
    label: "Missing H1 heading",
    whyItMatters:
      "The H1 heading helps both readers and search engines quickly understand the page's main topic.",
    recommendedAction: "Add a single, descriptive <h1> heading to this page.",
  },
  multiple_h1: {
    category: "structure",
    priority: "medium",
    label: "Multiple H1 headings",
    whyItMatters:
      "Multiple H1 headings can make it unclear which heading represents the page's single main topic.",
    recommendedAction: "Use one <h1> for the page's main heading; use <h2>/<h3> for subsections.",
  },
  images_missing_alt: {
    category: "structure",
    priority: "low",
    label: "Images missing alt text",
    whyItMatters:
      "Alt text lets search engines (and screen readers) understand what an image shows, and is required for the image to be eligible for image search results.",
    recommendedAction:
      "Add descriptive alt text to meaningful images; use alt=\"\" only for genuinely decorative images.",
  },
  invalid_structured_data: {
    category: "technical",
    priority: "low",
    label: "Invalid structured data",
    whyItMatters:
      "A structured data (JSON-LD) block that isn't valid JSON is ignored by search engines, forfeiting any rich-result eligibility it was meant to provide.",
    recommendedAction:
      "Fix the JSON syntax in this page's structured data script(s) so they parse as valid JSON.",
  },
  redirected: {
    category: "technical",
    priority: "low",
    label: "URL redirects",
    whyItMatters:
      "This URL doesn't respond directly — it sends visitors and search engines through one or more redirects before reaching its destination, which adds latency and means this exact address isn't what ultimately gets indexed.",
    recommendedAction:
      "Confirm the redirect is intentional. If links or the sitemap still reference this URL, consider updating them to point directly at the final destination.",
  },
  blocked_by_robots_txt: {
    category: "indexability",
    priority: "high",
    label: "Blocked by robots.txt",
    whyItMatters:
      "The site's robots.txt disallows this page for search engine crawlers, so it can't be crawled — even though it otherwise loads successfully — which typically keeps it out of search results.",
    recommendedAction:
      "Confirm this page is intentionally excluded from crawling. If not, update robots.txt so it no longer disallows this path.",
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
