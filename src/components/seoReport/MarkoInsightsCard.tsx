"use client";

import { useState } from "react";
import type { MarkoInsight } from "@/lib/reporting/markoInsights";
import { PriorityBadge, CategoryBadge } from "./badges";
import { AnalysisDetailModal } from "./AnalysisHistoryList";
import { usePreviewMaxHeight } from "./PreviewHeightMatch";

/**
 * MARKO Insights: up to 5 deterministic, factual insights derived from the
 * latest completed SEO analysis (see buildMarkoInsights) — no AI, no
 * Search Console dependency. Each row's affected-page count is already
 * stated in its explanation text, so it isn't repeated as a separate
 * number here. "View affected pages" reuses the exact same
 * AnalysisDetailModal/getCrawlRunDetail the Analysis History column uses
 * for the latest completed run — no new detail view, no new fetch logic.
 *
 * Height: capped to Website Preview's own measured rendered height via
 * `usePreviewMaxHeight()` (see PreviewHeightMatch.tsx) — a real
 * ResizeObserver measurement, not a CSS stretch/percentage assumption, so
 * this card's own content can never grow Preview or the row it sits in.
 * `null` (not yet measured, or below the `lg` breakpoint) means
 * unconstrained — no inline `maxHeight` is applied and the card falls
 * back to its natural content height, which is what mobile/tablet gets.
 * The header stays put (`shrink-0`); only the row list is the flexible,
 * scrollable child (`min-h-0 flex-1 overflow-y-auto`), so the full
 * available height up to the cap is used and a list that fits isn't
 * clipped or scrolled at all — only one that doesn't fit scrolls.
 */
export function MarkoInsightsCard({
  siteId,
  latestCompletedRun,
  insights,
}: {
  siteId: string;
  /** Null until at least one analysis has completed — distinguishes "no
   * analysis yet" from "analysis ran, nothing notable to report". */
  latestCompletedRun: { id: string; startedAt: string } | null;
  insights: MarkoInsight[];
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const maxHeight = usePreviewMaxHeight();

  return (
    <div
      className="flex shrink-0 flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white p-4"
      style={maxHeight !== null ? { maxHeight } : undefined}
    >
      <h2 className="shrink-0 text-xs font-semibold text-zinc-900">MARKO Insights</h2>

      {!latestCompletedRun ? (
        <p className="mt-2 shrink-0 text-xs text-zinc-500">
          Run an SEO analysis to see insights here.
        </p>
      ) : insights.length === 0 ? (
        <p className="mt-2 shrink-0 text-xs text-zinc-500">
          No notable findings from the latest analysis.
        </p>
      ) : (
        <ul className="mt-2 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">
          {insights.map((insight) => (
            <li
              key={insight.id}
              className="border-t border-zinc-100 pt-2.5 first:border-t-0 first:pt-0"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <PriorityBadge priority={insight.priority} />
                <CategoryBadge category={insight.category} />
              </div>
              <p className="mt-1 text-xs font-medium text-zinc-900">{insight.title}</p>
              <p className="mt-0.5 text-xs text-zinc-600">{insight.explanation}</p>
              {insight.hasAffectedPages && (
                <button
                  type="button"
                  onClick={() => setModalOpen(true)}
                  className="mt-1 text-xs font-medium text-primary-strong outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
                >
                  View affected pages
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {modalOpen && latestCompletedRun && (
        <AnalysisDetailModal
          siteId={siteId}
          run={{ id: latestCompletedRun.id, status: "completed", started_at: latestCompletedRun.startedAt }}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
