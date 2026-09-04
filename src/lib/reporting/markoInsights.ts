import type { CrawlIssueType } from "@/lib/crawler/analyze";
import {
  ISSUE_TAXONOMY,
  PRIORITY_LABELS,
  type IssueCategory,
  type IssuePriority,
} from "./issueTaxonomy";
import type { SeoHealthReport, SeoOpportunity } from "./seoHealthReport";
import type { SeoChangeReport } from "./seoChangeReport";

/**
 * MARKO Insights: a small set of factual, deterministic interpretations of
 * the latest completed SEO analysis (plus the comparison to the previous
 * one, when available). Pure derivation over already-persisted/already-
 * computed data (SeoHealthReport, SeoChangeReport) — no AI, no external
 * APIs, no Search Console dependency, no new data. Every number here is
 * traceable straight back to buildSeoHealthReport/buildSeoChangeReport, so
 * an insight is never anything beyond "N of M analyzed pages show finding
 * X" or "N issues changed since the previous analysis" — no causal,
 * traffic, ranking, or business-impact claims.
 */

export type MarkoInsightType = "priority" | "coverage" | "recent_change";

export type MarkoInsight = {
  /** Stable per underlying finding (e.g. `priority:missing_title`) — used
   * as the React key and, within buildMarkoInsights, to avoid surfacing
   * near-duplicate insights about the same current-state finding. */
  id: string;
  type: MarkoInsightType;
  title: string;
  explanation: string;
  priority: IssuePriority;
  category: IssueCategory;
  /** Count backing this insight's claim — affected pages for a
   * priority/coverage insight, or the number of changed issues for a
   * recent-change one. Always the number actually stated in `explanation`. */
  affectedPageCount: number;
  /** Whether there's something concrete to view right now in the latest
   * analysis for this insight (its issue is currently present) — a
   * "resolved" insight has nothing left to view, so this is false. */
  hasAffectedPages: boolean;
};

/** "Meaningful proportion" for the COVERAGE insight type and the
 * "remaining widespread" RECENT_CHANGE subtype — a fixed, documented
 * threshold rather than an AI judgment call, per CLAUDE.md's requirement
 * that any such classification be explainable from known rules. */
const PREVALENCE_THRESHOLD_RATIO = 0.5;

/** Below this many analyzed pages, "N of M" proportions aren't meaningful
 * (a 1-page site is trivially either 0% or 100% affected). */
const MIN_PAGES_FOR_PREVALENCE = 2;

/** Hard cap on how many insights are ever returned — see the MVP scope
 * ("maximum of 3–5 insights"). There's no corresponding minimum: when the
 * evidence doesn't support 3, showing fewer (including zero) is correct —
 * MARKO Insights interprets evidence, it doesn't invent findings to fill a
 * quota. */
const MAX_INSIGHTS = 5;

const PRIORITY_ORDER: Record<IssuePriority, number> = { high: 0, medium: 1, low: 2 };
const TYPE_ORDER: Record<MarkoInsightType, number> = { priority: 0, coverage: 1, recent_change: 2 };

function pluralize(count: number, singular: string, plural: string = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function percentOf(count: number, total: number): number {
  return Math.round((count / total) * 100);
}

function pageCountPhrase(count: number, total: number): string {
  return `${count} of ${total} analyzed ${pluralize(total, "page")}`;
}

function priorityInsight(opportunity: SeoOpportunity, pagesAnalyzed: number): MarkoInsight {
  const count = opportunity.affectedPages.length;
  return {
    id: `priority:${opportunity.issueType}`,
    type: "priority",
    // The title itself states the ranking judgment ("deserves attention
    // first"), not just the bare issue label an Opportunity card already
    // shows — the explanation then backs that up with the priority tier
    // and how many pages it actually touches.
    title: `${opportunity.label} is the top priority`,
    explanation:
      `${PRIORITY_LABELS[opportunity.priority]} priority — affects ${pageCountPhrase(count, pagesAnalyzed)}, ` +
      `the highest-priority finding in this audit.`,
    priority: opportunity.priority,
    category: opportunity.category,
    affectedPageCount: count,
    hasAffectedPages: count > 0,
  };
}

function coverageInsight(opportunity: SeoOpportunity, pagesAnalyzed: number): MarkoInsight {
  const count = opportunity.affectedPages.length;
  return {
    id: `coverage:${opportunity.issueType}`,
    type: "coverage",
    title: `${opportunity.label} is widespread`,
    explanation:
      `${pageCountPhrase(count, pagesAnalyzed)} (${percentOf(count, pagesAnalyzed)}%) have this finding: ` +
      `${opportunity.label}.`,
    priority: opportunity.priority,
    category: opportunity.category,
    affectedPageCount: count,
    hasAffectedPages: true,
  };
}

/** Coverage candidates, highest-proportion first (deterministic tie-break:
 * priority, then issue type). Excludes anything already used by another
 * insight (currently just the single PRIORITY pick) so the same current
 * finding isn't restated as both "most urgent" and "widespread". Returns
 * the source opportunities alongside their insights so the caller can mark
 * their issue types as used without re-parsing anything. */
function findCoverageOpportunities(
  opportunities: SeoOpportunity[],
  pagesAnalyzed: number,
  usedIssueTypes: Set<CrawlIssueType>,
): SeoOpportunity[] {
  if (pagesAnalyzed < MIN_PAGES_FOR_PREVALENCE) return [];

  return opportunities
    .filter((o) => !usedIssueTypes.has(o.issueType))
    .filter((o) => o.affectedPages.length / pagesAnalyzed >= PREVALENCE_THRESHOLD_RATIO)
    .sort((a, b) => {
      const proportionDiff = b.affectedPages.length / pagesAnalyzed - a.affectedPages.length / pagesAnalyzed;
      if (proportionDiff !== 0) return proportionDiff;
      const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.issueType < b.issueType ? -1 : a.issueType > b.issueType ? 1 : 0;
    });
}

function resolvedInsight(changeReport: Extract<SeoChangeReport, { status: "compared" }>): MarkoInsight {
  const { resolvedCount } = changeReport.summary;
  // `resolved` is already sorted priority-first (see buildSeoChangeReport),
  // so [0] is a deterministic, well-defined "most notable" example.
  const top = changeReport.resolved[0];
  return {
    id: "recent_change:resolved",
    type: "recent_change",
    title: `${resolvedCount} ${pluralize(resolvedCount, "issue")} resolved`,
    explanation:
      `Since the previous analysis, ${resolvedCount} previously-flagged ${pluralize(resolvedCount, "issue")} ` +
      `${pluralize(resolvedCount, "no longer appears", "no longer appear")} in the latest analysis, including ` +
      `${top.label} on ${top.url}.`,
    priority: top.priority,
    category: top.category,
    affectedPageCount: resolvedCount,
    hasAffectedPages: false,
  };
}

/**
 * The "genuinely new issues" insight — or `null` when it wouldn't add
 * anything not already said. `newIssues` is already sorted priority-first
 * (see buildSeoChangeReport); the representative example is the first one
 * whose issue type *isn't* already the subject of a higher-ranked
 * PRIORITY/COVERAGE/"remains widespread" insight, preserving that order
 * among the eligible candidates. Citing an issue that's already fully
 * explained elsewhere adds no real information — e.g. "1 new occurrence"
 * of something already reported as affecting every analyzed page is a
 * rounding-level detail, not a meaningful change, since the qualitative
 * picture ("this is a sitewide problem") was already stated. If every new
 * issue's type is already covered elsewhere, this returns `null`: the bare
 * count with no non-redundant example to illustrate it isn't worth a slot
 * (see MAX_INSIGHTS' doc comment — there's no minimum to hit).
 */
function findNewIssuesInsight(
  changeReport: Extract<SeoChangeReport, { status: "compared" }>,
  usedIssueTypes: Set<CrawlIssueType>,
): MarkoInsight | null {
  const { newIssues, summary } = changeReport;
  if (summary.newCount === 0) return null;

  const representative = newIssues.find((issue) => !usedIssueTypes.has(issue.issueType));
  if (!representative) return null;

  return {
    id: "recent_change:new",
    type: "recent_change",
    title: `${summary.newCount} new ${pluralize(summary.newCount, "issue")} found`,
    explanation:
      `Since the previous analysis, ${summary.newCount} genuinely new ${pluralize(summary.newCount, "issue")} ` +
      `${pluralize(summary.newCount, "was", "were")} found on pages analyzed successfully both times, including ` +
      `${representative.label} on ${representative.url}. Findings on pages analyzed for the first time are not ` +
      `counted here.`,
    priority: representative.priority,
    category: representative.category,
    affectedPageCount: summary.newCount,
    hasAffectedPages: true,
  };
}

/** The single most-widespread issue type that persisted across both the
 * previous and the latest analysis (present in `remaining`), if any meets
 * the same prevalence bar as the COVERAGE insight type. Excludes issue
 * types already used by PRIORITY/COVERAGE — this is otherwise the same
 * "current widespread finding" claim, just with a persistence angle. */
function findRemainingWidespreadInsight(
  changeReport: Extract<SeoChangeReport, { status: "compared" }>,
  pagesAnalyzed: number,
  usedIssueTypes: Set<CrawlIssueType>,
): { issueType: CrawlIssueType; insight: MarkoInsight } | null {
  if (pagesAnalyzed < MIN_PAGES_FOR_PREVALENCE) return null;

  const countByType = new Map<CrawlIssueType, number>();
  for (const changed of changeReport.remaining) {
    if (usedIssueTypes.has(changed.issueType)) continue;
    countByType.set(changed.issueType, (countByType.get(changed.issueType) ?? 0) + 1);
  }

  let best: { issueType: CrawlIssueType; count: number } | null = null;
  for (const [issueType, count] of countByType) {
    if (count / pagesAnalyzed < PREVALENCE_THRESHOLD_RATIO) continue;
    if (
      !best ||
      count > best.count ||
      (count === best.count &&
        (PRIORITY_ORDER[ISSUE_TAXONOMY[issueType].priority] <
          PRIORITY_ORDER[ISSUE_TAXONOMY[best.issueType].priority] ||
          (ISSUE_TAXONOMY[issueType].priority === ISSUE_TAXONOMY[best.issueType].priority &&
            issueType < best.issueType)))
    ) {
      best = { issueType, count };
    }
  }
  if (!best) return null;

  const taxonomy = ISSUE_TAXONOMY[best.issueType];
  return {
    issueType: best.issueType,
    insight: {
      id: `recent_change:remaining:${best.issueType}`,
      type: "recent_change",
      title: `${taxonomy.label} remains widespread`,
      explanation:
        `${pageCountPhrase(best.count, pagesAnalyzed)} (${percentOf(best.count, pagesAnalyzed)}%) still have this ` +
        `finding — present in both the current and the previous analysis: ${taxonomy.label}.`,
      priority: taxonomy.priority,
      category: taxonomy.category,
      affectedPageCount: best.count,
      hasAffectedPages: true,
    },
  };
}

function rankInsights(insights: MarkoInsight[]): MarkoInsight[] {
  return [...insights].sort((a, b) => {
    const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    const impactDiff = b.affectedPageCount - a.affectedPageCount;
    if (impactDiff !== 0) return impactDiff;
    const typeDiff = TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
    if (typeDiff !== 0) return typeDiff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Builds up to MAX_INSIGHTS MarkoInsight entries from the latest completed
 * analysis's health report and (when available) its comparison to the
 * previous one. Deterministic and side-effect-free — safe to call on every
 * render, and independently testable without any DB/network access.
 */
export function buildMarkoInsights(
  healthReport: SeoHealthReport,
  changeReport: SeoChangeReport,
): MarkoInsight[] {
  const pagesAnalyzed = healthReport.summary.pagesAnalyzed;
  const usedIssueTypes = new Set<CrawlIssueType>();
  const candidates: MarkoInsight[] = [];

  // 1. PRIORITY — the single highest-priority current finding.
  // healthReport.opportunities is already sorted priority-first, then by
  // affected-page count (see buildSeoHealthReport), so [0] is the correct,
  // deterministic pick with no re-sorting needed here.
  const topOpportunity = healthReport.opportunities[0];
  if (topOpportunity) {
    candidates.push(priorityInsight(topOpportunity, pagesAnalyzed));
    usedIssueTypes.add(topOpportunity.issueType);
  }

  // 2. RECENT CHANGE — "remains widespread" is checked *before* COVERAGE
  // below: a widespread issue's current affected-page count is always >=
  // its `remaining` count (remaining is a subset of "currently has this
  // issue"), so whenever an issue qualifies as "remains widespread" it
  // would otherwise always also qualify for plain COVERAGE — claiming its
  // issue type here first gives it the more informative persistence
  // framing instead of a duplicate plain-widespread one.
  if (changeReport.status === "compared") {
    const remainingWidespread = findRemainingWidespreadInsight(changeReport, pagesAnalyzed, usedIssueTypes);
    if (remainingWidespread) {
      candidates.push(remainingWidespread.insight);
      usedIssueTypes.add(remainingWidespread.issueType);
    }
  }

  // 3. COVERAGE — other findings affecting a meaningful proportion of
  // pages (widespread issues with no persistence data, or not part of
  // `remaining` — e.g. newly-introduced-and-already-widespread).
  for (const opportunity of findCoverageOpportunities(healthReport.opportunities, pagesAnalyzed, usedIssueTypes)) {
    candidates.push(coverageInsight(opportunity, pagesAnalyzed));
    usedIssueTypes.add(opportunity.issueType);
  }

  // 4. RECENT CHANGE — resolved/new. Evaluated last, after every
  // type-claiming insight above has been decided: "resolved" doesn't need
  // to avoid a used type (a resolved-on-one-page + still-widespread-
  // elsewhere pairing is genuinely complementary information, not a
  // duplicate), but "new" does (see findNewIssuesInsight) — so it needs
  // the *complete* usedIssueTypes set, not just PRIORITY's.
  if (changeReport.status === "compared") {
    if (changeReport.summary.resolvedCount > 0) {
      candidates.push(resolvedInsight(changeReport));
    }
    const newInsight = findNewIssuesInsight(changeReport, usedIssueTypes);
    if (newInsight) {
      candidates.push(newInsight);
    }
  }

  return rankInsights(candidates).slice(0, MAX_INSIGHTS);
}
