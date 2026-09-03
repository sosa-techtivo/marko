"use client";

import { useEffect, useId, useState } from "react";
import { isBotProtectionFailureMessage } from "@/lib/crawler/botProtection";
import { getCrawlRunDetail, type CrawlRunDetailResult } from "@/app/dashboard/sites/[slug]/actions";
import { StatusBadge, SummaryStat } from "./badges";
import { OpportunitiesList } from "./OpportunitiesList";
import { AnalyzedPagesTable } from "./AnalyzedPagesTable";

/** Mirrors the crawl_runs columns the page already selects for the
 * Analysis History list — a plain, serializable shape since this crosses
 * the server/client boundary as props. */
export type HistoryRun = {
  id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  pages_crawled: number;
  error_message: string | null;
};

/** Same three states as StatusBadge, plus a distinct "Blocked" state for a
 * failed run whose failure was a confirmed bot-protection block. */
function HistoryStatusBadge({ status, isBlocked }: { status: string; isBlocked: boolean }) {
  if (isBlocked) {
    return (
      <span className="inline-block rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
        Blocked
      </span>
    );
  }
  return <StatusBadge status={status} />;
}

function HistoryListRow({
  run,
  issueCount,
  isLatest,
  onSelect,
}: {
  run: HistoryRun;
  issueCount: number | null;
  isLatest: boolean;
  /** Only completed runs have a persisted report to open — null disables
   * the row's click affordance entirely rather than opening an empty/
   * meaningless detail view for a running or failed attempt. */
  onSelect: (() => void) | null;
}) {
  const isBlocked = run.status === "failed" && isBotProtectionFailureMessage(run.error_message);

  const rowContent = (
    <>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-xs font-medium text-zinc-900">
          {new Date(run.started_at).toLocaleString()}
          {isLatest && (
            <span className="inline-block shrink-0 rounded-md bg-primary-tint px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-primary-strong uppercase">
              Latest
            </span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500">
          {run.status === "completed"
            ? `${run.pages_crawled} page${run.pages_crawled === 1 ? "" : "s"}${
                issueCount !== null
                  ? ` · ${issueCount} opportunit${issueCount === 1 ? "y" : "ies"}`
                  : ""
              }`
            : isBlocked
              ? "Could not access site"
              : run.status === "failed"
                ? "Analysis failed"
                : "In progress"}
        </p>
      </div>
      <HistoryStatusBadge status={run.status} isBlocked={isBlocked} />
    </>
  );

  const rowClassName =
    "flex w-full items-center justify-between gap-2 rounded-md border border-transparent px-2 py-2 text-left text-xs hover:bg-zinc-50";

  if (!onSelect) {
    return <li className={rowClassName}>{rowContent}</li>;
  }

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`${rowClassName} outline-none focus-visible:ring-2 focus-visible:ring-primary`}
      >
        {rowContent}
      </button>
    </li>
  );
}

/**
 * Full detail for one historical analysis, opened on demand from a list
 * row click. Same layout/content the old permanently-visible detail panel
 * showed, and the same close/dismiss pattern already used by the Changes
 * Since Last Analysis modal (ChangesSinceLastAnalysisCard) — Escape key,
 * backdrop click, and an explicit close button.
 *
 * Fetches via the existing getCrawlRunDetail server action, which only
 * reads that run's already-persisted crawl_pages/crawl_issues rows — no
 * re-crawl, no new analysis, never influenced by the site's current latest
 * run.
 *
 * Exported (and `run` narrowed to only the fields actually used here) so
 * MarkoInsightsCard can open the exact same modal for the latest completed
 * run from an insight's "View affected pages" action, without needing a
 * full HistoryRun (pages_crawled/error_message aren't available — or
 * needed — there).
 */
export function AnalysisDetailModal({
  siteId,
  run,
  onClose,
}: {
  siteId: string;
  run: Pick<HistoryRun, "id" | "status" | "started_at">;
  onClose: () => void;
}) {
  const titleId = useId();
  const [result, setResult] = useState<CrawlRunDetailResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCrawlRunDetail(siteId, run.id).then((fetched) => {
      if (!cancelled) setResult(fetched);
    });
    return () => {
      cancelled = true;
    };
  }, [siteId, run.id]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function handleBackdropClick(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 px-4"
      onClick={handleBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[85vh] w-[85vw] max-w-[1150px] flex-col rounded-xl border border-zinc-200 bg-white shadow-lg"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-100 p-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-zinc-900">
              {new Date(run.started_at).toLocaleString()}
            </h2>
            <div className="mt-1.5">
              <StatusBadge status={run.status} />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 text-zinc-400 outline-none hover:bg-zinc-100 hover:text-zinc-600 focus-visible:ring-2 focus-visible:ring-primary"
          >
            <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Only the body scrolls — the header stays put and the dialog
            itself never grows past 85% of the viewport height. */}
        <div className="overflow-y-auto p-4">
          {!result ? (
            <p className="py-8 text-center text-xs text-zinc-500">Loading…</p>
          ) : !result.ok ? (
            <p className="py-8 text-center text-xs text-red-600">{result.error}</p>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <SummaryStat label="Pages analyzed" value={result.summary.pagesAnalyzed} />
                <SummaryStat label="Pages with issues" value={result.summary.pagesWithIssues} />
                <SummaryStat
                  label="High-priority issues"
                  value={result.summary.highPriorityIssues}
                />
                <SummaryStat label="Total opportunities" value={result.summary.totalIssues} />
              </div>

              <div>
                <h3 className="text-xs font-semibold text-zinc-900">Opportunities</h3>
                {result.opportunities.length > 0 ? (
                  <div className="mt-2">
                    <OpportunitiesList opportunities={result.opportunities} />
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-zinc-500">
                    No opportunities identified in this crawl.
                  </p>
                )}
              </div>

              <div>
                <h3 className="text-xs font-semibold text-zinc-900">
                  Analyzed pages ({result.pages.length})
                </h3>
                {result.pages.length > 0 ? (
                  <div className="mt-2">
                    <AnalyzedPagesTable pages={result.pages} issues={result.issues} />
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-zinc-500">No pages recorded for this crawl.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Analysis history: the second card in the center dashboard column, below
 * MARKO Insights (see page.tsx). `min-h-0 flex-1` (as a flex child of that
 * column's flex-col wrapper, alongside Insights above it — Insights is
 * `shrink-0` and height-capped independently via PreviewHeightMatch, so
 * this card fills whatever height is left over in the column) — rather
 * than its own row count ever growing the page taller: the row list is
 * the only flexible child inside this card (`min-h-0 flex-1
 * overflow-y-auto`), so extra rows scroll internally instead. Individual
 * rows stay compact regardless. Clicking a completed run opens its full
 * persisted report in a modal (AnalysisDetailModal) rather than rendering
 * detail inline — nothing is fetched until a run is actually opened, and
 * only one detail fetch happens per click (the same getCrawlRunDetail
 * action as before).
 */
export function AnalysisHistorySection({
  siteId,
  runs,
  issueCounts,
}: {
  siteId: string;
  runs: HistoryRun[];
  issueCounts: Record<string, number>;
}) {
  const [openRun, setOpenRun] = useState<HistoryRun | null>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="shrink-0 text-xs font-semibold text-zinc-900">Analysis history</h2>
      {runs.length === 0 ? (
        <p className="mt-2 shrink-0 text-xs text-zinc-500">No previous analyses yet.</p>
      ) : (
        <ul className="mt-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {runs.map((run, index) => (
            <HistoryListRow
              key={run.id}
              run={run}
              isLatest={index === 0}
              issueCount={run.status === "completed" ? (issueCounts[run.id] ?? 0) : null}
              onSelect={run.status === "completed" ? () => setOpenRun(run) : null}
            />
          ))}
        </ul>
      )}

      {openRun && (
        <AnalysisDetailModal siteId={siteId} run={openRun} onClose={() => setOpenRun(null)} />
      )}
    </div>
  );
}
