"use client";

import { useEffect, useState } from "react";
import { isBotProtectionFailureMessage } from "@/lib/crawler/botProtection";
import { getCrawlRunDetail, type CrawlRunDetailResult } from "@/app/dashboard/sites/[siteId]/actions";
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
  isSelected,
  onSelect,
}: {
  run: HistoryRun;
  issueCount: number | null;
  isLatest: boolean;
  isSelected: boolean;
  /** Only completed runs have a persisted report to select — null disables
   * the row's click affordance entirely rather than selecting an empty/
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

  // Selected state is a border/background highlight, not a separate
  // component — same row shape whether or not it's currently selected.
  const rowClassName = `flex w-full items-center justify-between gap-2 rounded-md border px-2 py-2 text-left text-xs ${
    isSelected ? "border-primary/40 bg-primary-tint" : "border-transparent hover:bg-zinc-50"
  }`;

  if (!onSelect) {
    return <li className={rowClassName}>{rowContent}</li>;
  }

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={isSelected ? "true" : undefined}
        className={`${rowClassName} outline-none focus-visible:ring-2 focus-visible:ring-primary`}
      >
        {rowContent}
      </button>
    </li>
  );
}

/**
 * Master-detail replacement for the old Analysis History card + modal:
 * a vertical, selectable list of recent runs on the left, and a
 * permanently-visible detail panel on the right for whichever one is
 * selected — showing the exact same content the modal used to (reusing
 * the same getCrawlRunDetail server action and the same shared
 * SummaryStat/OpportunitiesList/AnalyzedPagesTable components, so nothing
 * about how a historical report is fetched or rendered is duplicated).
 *
 * Selecting a row is pure client-side UI state: it re-reads that run's
 * already-persisted report, never reruns or recalculates anything, and
 * never touches or is influenced by the site's current latest run.
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
  // Defaults to the newest *completed* run — not necessarily `runs[0]`
  // (which might be a still-running or failed latest attempt) — since only
  // a completed run has a persisted report to show in the detail panel.
  const firstCompletedRun = runs.find((run) => run.status === "completed") ?? null;
  const [selectedRun, setSelectedRun] = useState<HistoryRun | null>(firstCompletedRun);
  const [detailState, setDetailState] = useState<{
    runId: string;
    result: CrawlRunDetailResult;
  } | null>(null);

  useEffect(() => {
    if (!selectedRun) return;
    let cancelled = false;
    getCrawlRunDetail(siteId, selectedRun.id).then((result) => {
      if (!cancelled) setDetailState({ runId: selectedRun.id, result });
    });
    return () => {
      cancelled = true;
    };
  }, [siteId, selectedRun]);

  // Derived, not reset imperatively: switching the selection doesn't need
  // a synchronous "clear to loading" setState in the effect above — the
  // panel just shows "loading" for any run whose cached result doesn't
  // match the current selection yet.
  const detail = selectedRun && detailState?.runId === selectedRun.id ? detailState.result : null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_7fr]">
      {/* Left (~30%): the selectable list. */}
      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">Analysis history</h2>
        {runs.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-500">No previous analyses yet.</p>
        ) : (
          <ul className="mt-2 flex max-h-[32rem] flex-col gap-1 overflow-y-auto">
            {runs.map((run, index) => (
              <HistoryListRow
                key={run.id}
                run={run}
                isLatest={index === 0}
                isSelected={selectedRun?.id === run.id}
                issueCount={run.status === "completed" ? (issueCounts[run.id] ?? 0) : null}
                onSelect={run.status === "completed" ? () => setSelectedRun(run) : null}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Right (~70%): the permanently-visible detail panel — same
          content/layout the historical-analysis modal used to show. */}
      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        {!selectedRun ? (
          <p className="text-sm text-zinc-500">No completed analyses yet.</p>
        ) : (
          <>
            <div>
              <h3 className="text-lg font-semibold text-zinc-900">
                {new Date(selectedRun.started_at).toLocaleString()}
              </h3>
              <div className="mt-1.5">
                <StatusBadge status={selectedRun.status} />
              </div>
            </div>

            <div className="mt-4">
              {!detail ? (
                <p className="py-8 text-center text-sm text-zinc-500">Loading…</p>
              ) : !detail.ok ? (
                <p className="py-8 text-center text-sm text-red-600">{detail.error}</p>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <SummaryStat label="Pages analyzed" value={detail.summary.pagesAnalyzed} />
                    <SummaryStat
                      label="Pages with issues"
                      value={detail.summary.pagesWithIssues}
                    />
                    <SummaryStat
                      label="High-priority issues"
                      value={detail.summary.highPriorityIssues}
                    />
                    <SummaryStat label="Total opportunities" value={detail.summary.totalIssues} />
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold text-zinc-900">Opportunities</h4>
                    {detail.opportunities.length > 0 ? (
                      <div className="mt-2">
                        <OpportunitiesList opportunities={detail.opportunities} />
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-zinc-500">
                        No opportunities identified in this crawl.
                      </p>
                    )}
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold text-zinc-900">
                      Analyzed pages ({detail.pages.length})
                    </h4>
                    {detail.pages.length > 0 ? (
                      <div className="mt-2">
                        <AnalyzedPagesTable pages={detail.pages} issues={detail.issues} />
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-zinc-500">
                        No pages recorded for this crawl.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
