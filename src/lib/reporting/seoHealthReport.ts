import type { CrawlIssueType } from "@/lib/crawler/analyze";
import {
  ISSUE_TAXONOMY,
  type IssueCategory,
  type IssuePriority,
} from "./issueTaxonomy";

/**
 * Turns a completed crawl's raw pages + issues into the SEO Health Summary
 * and Top Opportunities the site detail page renders. Pure, deterministic,
 * derived entirely from already-persisted crawl_pages/crawl_issues rows —
 * no AI, no new data, no scoring.
 */

export type CrawlPageRow = {
  id: string;
  url: string;
  http_status: number | null;
  title: string | null;
  meta_description: string | null;
  h1: string | null;
  canonical_url: string | null;
  is_indexable: boolean;
};

export type CrawlIssueRow = {
  id: string;
  crawl_page_id: string;
  issue_type: string;
  message: string;
};

export type SeoOpportunity = {
  issueType: CrawlIssueType;
  category: IssueCategory;
  priority: IssuePriority;
  label: string;
  whyItMatters: string;
  recommendedAction: string;
  affectedPages: { url: string; message: string }[];
};

export type SeoHealthReport = {
  summary: {
    pagesAnalyzed: number;
    pagesWithIssues: number;
    highPriorityIssues: number;
    totalIssues: number;
  };
  opportunities: SeoOpportunity[];
  /** Only meaningful/non-empty when there are zero issues; see buildSeoHealthReport. */
  positiveSignals: string[];
};

const PRIORITY_ORDER: Record<IssuePriority, number> = { high: 0, medium: 1, low: 2 };

function isKnownIssueType(type: string): type is CrawlIssueType {
  return Object.prototype.hasOwnProperty.call(ISSUE_TAXONOMY, type);
}

function buildPositiveSignals(pages: CrawlPageRow[]): string[] {
  if (pages.length === 0) return [];

  const signals: string[] = [];
  const count = pages.length;
  const plural = count === 1 ? "page" : "pages";

  if (pages.every((p) => p.http_status !== null && p.http_status >= 200 && p.http_status < 300)) {
    signals.push(`All ${count} analyzed ${plural} returned a successful response.`);
  }
  if (pages.every((p) => !!p.title)) {
    signals.push("Every analyzed page has a title tag.");
  }
  if (pages.every((p) => !!p.meta_description)) {
    signals.push("Every analyzed page has a meta description.");
  }
  if (pages.every((p) => !!p.h1)) {
    signals.push("Every analyzed page has an H1 heading.");
  }
  if (pages.every((p) => p.is_indexable)) {
    signals.push(
      count === 1
        ? "The analyzed page is not blocked from indexing."
        : "None of the analyzed pages are blocked from indexing.",
    );
  }
  if (pages.every((p) => !!p.canonical_url)) {
    signals.push("Every analyzed page has a canonical tag.");
  }

  return signals;
}

export function buildSeoHealthReport(
  pages: CrawlPageRow[],
  issues: CrawlIssueRow[],
): SeoHealthReport {
  const pageUrlById = new Map(pages.map((p) => [p.id, p.url]));

  const byType = new Map<CrawlIssueType, SeoOpportunity>();
  for (const issue of issues) {
    if (!isKnownIssueType(issue.issue_type)) continue;
    const taxonomy = ISSUE_TAXONOMY[issue.issue_type];

    let opportunity = byType.get(issue.issue_type);
    if (!opportunity) {
      opportunity = {
        issueType: issue.issue_type,
        category: taxonomy.category,
        priority: taxonomy.priority,
        label: taxonomy.label,
        whyItMatters: taxonomy.whyItMatters,
        recommendedAction: taxonomy.recommendedAction,
        affectedPages: [],
      };
      byType.set(issue.issue_type, opportunity);
    }
    opportunity.affectedPages.push({
      url: pageUrlById.get(issue.crawl_page_id) ?? "Unknown page",
      message: issue.message,
    });
  }

  const opportunities = Array.from(byType.values()).sort((a, b) => {
    const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return b.affectedPages.length - a.affectedPages.length;
  });

  const pagesWithIssues = new Set(issues.map((i) => i.crawl_page_id)).size;
  const highPriorityIssues = issues.filter(
    (i) => isKnownIssueType(i.issue_type) && ISSUE_TAXONOMY[i.issue_type].priority === "high",
  ).length;

  return {
    summary: {
      pagesAnalyzed: pages.length,
      pagesWithIssues,
      highPriorityIssues,
      totalIssues: issues.length,
    },
    opportunities,
    positiveSignals: issues.length === 0 ? buildPositiveSignals(pages) : [],
  };
}
