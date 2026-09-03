"use client";

import { useEffect, useId, useState } from "react";
import type { ChangedIssue, SeoChangeReport } from "@/lib/reporting/seoChangeReport";
import { PriorityBadge, CategoryBadge, SummaryStat } from "./badges";

/** How many individual change rows the compact card previews before
 * pointing to the modal for the rest — keeps the card's height bounded
 * regardless of how many issues changed, so it stays the same height as
 * the other top-row cards. */
const PREVIEW_ITEM_LIMIT = 3;

type PreviewChange = ChangedIssue & { kind: "resolved" | "new" };

function KindBadge({ kind }: { kind: "resolved" | "new" }) {
  const colors =
    kind === "resolved"
      ? "border-green-200 bg-green-50 text-green-700"
      : "border-blue-200 bg-blue-50 text-blue-700";
  return (
    <span
      className={`inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${colors}`}
    >
      {kind === "resolved" ? "Resolved" : "New"}
    </span>
  );
}

function PreviewChangeRow({ issue }: { issue: PreviewChange }) {
  return (
    <li className="flex flex-wrap items-center gap-1.5 py-1 text-xs">
      <KindBadge kind={issue.kind} />
      <PriorityBadge priority={issue.priority} />
      <span className="font-medium text-zinc-900">{issue.label}</span>
      <span className="max-w-[9rem] truncate text-zinc-500">{issue.url}</span>
    </li>
  );
}

function ChangeSection({
  title,
  issues,
  emptyText,
}: {
  title: string;
  issues: ChangedIssue[];
  emptyText: string;
}) {
  return (
    <div className="mt-4 border-t border-zinc-100 pt-3">
      <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
        {title} ({issues.length})
      </h3>
      {issues.length === 0 ? (
        <p className="mt-1.5 text-xs text-zinc-500">{emptyText}</p>
      ) : (
        <ul className="mt-1 divide-y divide-zinc-100">
          {issues.map((issue) => (
            <li
              key={`${issue.issueType}-${issue.url}`}
              className="flex flex-wrap items-center gap-1.5 py-1.5 text-xs"
            >
              <PriorityBadge priority={issue.priority} />
              <CategoryBadge category={issue.category} />
              <span className="font-medium text-zinc-900">{issue.label}</span>
              <span className="max-w-sm truncate text-zinc-500">{issue.url}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Full comparison detail — reuses the exact same `changeReport` data the
 * compact card previews from; no new reporting logic or queries. */
function ChangesModal({
  changeReport,
  onClose,
}: {
  changeReport: Extract<SeoChangeReport, { status: "compared" }>;
  onClose: () => void;
}) {
  const titleId = useId();

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
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-zinc-200 bg-white shadow-lg"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-100 p-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-zinc-900">
              Changes Since Last Analysis
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Comparing {new Date(changeReport.previousRun.startedAt).toLocaleString()} to{" "}
              {new Date(changeReport.latestRun.startedAt).toLocaleString()}.
            </p>
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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <SummaryStat label="Resolved" value={changeReport.summary.resolvedCount} />
            <SummaryStat label="New" value={changeReport.summary.newCount} />
            <SummaryStat label="Remaining" value={changeReport.summary.remainingCount} />
            <div className="flex flex-col gap-1">
              <p className="text-2xl font-semibold text-zinc-900">
                {changeReport.summary.previousPagesWithIssues} →{" "}
                {changeReport.summary.currentPagesWithIssues}
              </p>
              <p className="text-xs text-zinc-500">Pages with issues</p>
            </div>
          </div>

          {changeReport.summary.excludedPreviousIssueCount > 0 && (
            <p className="mt-3 text-xs text-zinc-500">
              {changeReport.summary.excludedPreviousIssueCount} previously-flagged issue
              {changeReport.summary.excludedPreviousIssueCount === 1 ? "" : "s"} on page
              {changeReport.summary.excludedPreviousIssueCount === 1 ? "" : "s"} not successfully
              re-analyzed in this crawl{" "}
              {changeReport.summary.excludedPreviousIssueCount === 1 ? "is" : "are"} excluded from
              this comparison — not counted as resolved.
            </p>
          )}

          <ChangeSection
            title="Resolved"
            issues={changeReport.resolved}
            emptyText="No issues were resolved since the previous analysis."
          />
          <ChangeSection
            title="New"
            issues={changeReport.newIssues}
            emptyText="No new issues were introduced since the previous analysis."
          />
          <ChangeSection
            title="Remaining"
            issues={changeReport.remaining}
            emptyText="No issues remained unchanged since the previous analysis."
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Compact by construction: previews at most PREVIEW_ITEM_LIMIT individual
 * changes (new issues first, then resolved, since a new problem is
 * generally the more actionable thing to surface) and never renders the
 * full Resolved/New lists or an internal scroll area — so this card's
 * height stays the same regardless of how many issues changed between
 * runs, matching the other three fixed-height top-row cards. "View more"
 * opens a modal with the full detail, reusing this exact same
 * `changeReport` (no new reporting logic/queries).
 */
export function ChangesSinceLastAnalysisCard({
  changeReport,
  changeSummaryMessage,
}: {
  changeReport: SeoChangeReport;
  changeSummaryMessage: string | null;
}) {
  const [modalOpen, setModalOpen] = useState(false);

  const previewItems: PreviewChange[] =
    changeReport.status === "compared"
      ? [
          ...changeReport.newIssues.map((issue): PreviewChange => ({ ...issue, kind: "new" })),
          ...changeReport.resolved.map((issue): PreviewChange => ({ ...issue, kind: "resolved" })),
        ].slice(0, PREVIEW_ITEM_LIMIT)
      : [];

  const totalDetailCount =
    changeReport.status === "compared"
      ? changeReport.resolved.length + changeReport.newIssues.length + changeReport.remaining.length
      : 0;

  return (
    <div className="flex h-full flex-col rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-zinc-900">Changes Since Last Analysis</h2>

      {changeReport.status === "no-previous-run" ? (
        <p className="mt-2 text-sm text-zinc-600">
          No previous analysis is available for comparison yet. This is the first completed crawl
          for this site.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-zinc-500">
            Comparing {new Date(changeReport.previousRun.startedAt).toLocaleString()} to{" "}
            {new Date(changeReport.latestRun.startedAt).toLocaleString()}.
          </p>

          <p className="mt-2 text-xs font-medium text-zinc-900">{changeSummaryMessage}</p>

          <div className="mt-2 grid grid-cols-2 gap-3">
            <SummaryStat label="Resolved" value={changeReport.summary.resolvedCount} />
            <SummaryStat label="New" value={changeReport.summary.newCount} />
            <SummaryStat label="Remaining" value={changeReport.summary.remainingCount} />
            <div className="flex flex-col gap-1">
              <p className="text-2xl font-semibold text-zinc-900">
                {changeReport.summary.previousPagesWithIssues} →{" "}
                {changeReport.summary.currentPagesWithIssues}
              </p>
              <p className="text-xs text-zinc-500">Pages with issues</p>
            </div>
          </div>

          {changeReport.summary.excludedPreviousIssueCount > 0 && (
            <p className="mt-2 text-xs text-zinc-500">
              {changeReport.summary.excludedPreviousIssueCount} previously-flagged issue
              {changeReport.summary.excludedPreviousIssueCount === 1 ? "" : "s"} on page
              {changeReport.summary.excludedPreviousIssueCount === 1 ? "" : "s"} not successfully
              re-analyzed in this crawl{" "}
              {changeReport.summary.excludedPreviousIssueCount === 1 ? "is" : "are"} excluded from
              this comparison — not counted as resolved.
            </p>
          )}

          {previewItems.length > 0 && (
            <div className="mt-3 border-t border-zinc-100 pt-2">
              <ul className="divide-y divide-zinc-100">
                {previewItems.map((issue) => (
                  <PreviewChangeRow key={`${issue.kind}-${issue.issueType}-${issue.url}`} issue={issue} />
                ))}
              </ul>
            </div>
          )}

          {totalDetailCount > 0 && (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="mt-2 self-start rounded-md text-xs font-medium text-primary-strong outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
            >
              View more
            </button>
          )}
        </>
      )}

      {modalOpen && changeReport.status === "compared" && (
        <ChangesModal changeReport={changeReport} onClose={() => setModalOpen(false)} />
      )}
    </div>
  );
}
