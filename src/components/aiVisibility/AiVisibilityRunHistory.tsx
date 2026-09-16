"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/seoReport/badges";
import { AiVisibilityRunDetailModal } from "./AiVisibilityRunDetailModal";

export type AiVisibilityHistoryRun = {
  id: string;
  status: string;
  startedAt: string;
  questionCount: number;
  succeededCount: number;
  failedCount: number;
  errorMessage: string | null;
};

function HistoryRow({
  run,
  isLatest,
  onSelect,
}: {
  run: AiVisibilityHistoryRun;
  isLatest: boolean;
  onSelect: (() => void) | null;
}) {
  const summary =
    run.status === "completed"
      ? `${run.questionCount} question${run.questionCount === 1 ? "" : "s"} · ${run.succeededCount} succeeded · ${run.failedCount} failed`
      : run.status === "failed"
        ? (run.errorMessage ?? "Run failed")
        : "In progress";

  const content = (
    <>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-xs font-medium text-zinc-900">
          {new Date(run.startedAt).toLocaleString()}
          {isLatest && (
            <span className="inline-block shrink-0 rounded-md bg-primary-tint px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-primary-strong uppercase">
              Latest
            </span>
          )}
        </p>
        <p className="mt-0.5 truncate text-xs text-zinc-500">{summary}</p>
      </div>
      <StatusBadge status={run.status} />
    </>
  );

  const rowClassName =
    "flex w-full items-center justify-between gap-2 rounded-md border border-transparent px-2 py-2 text-left text-xs hover:bg-zinc-50";

  if (!onSelect) {
    return <li className={rowClassName}>{content}</li>;
  }

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`${rowClassName} outline-none focus-visible:ring-2 focus-visible:ring-primary`}
      >
        {content}
      </button>
    </li>
  );
}

/** AI Visibility run history — same list-plus-detail-modal pattern as the
 * SEO report's Analysis History section (AnalysisHistoryList.tsx): only
 * the latest run's baseline is guaranteed to exist for a new site; opening
 * any run fetches its persisted results on demand, nothing is prefetched.
 * Multi-run trend comparison is explicitly out of scope for this slice —
 * this only ever lists runs and opens one at a time. */
export function AiVisibilityRunHistory({ siteId, runs }: { siteId: string; runs: AiVisibilityHistoryRun[] }) {
  const [openRun, setOpenRun] = useState<AiVisibilityHistoryRun | null>(null);

  if (runs.length === 0) {
    return <p className="text-xs text-zinc-500">No AI Visibility runs yet.</p>;
  }

  return (
    <>
      <ul className="flex flex-col gap-1">
        {runs.map((run, index) => (
          <HistoryRow
            key={run.id}
            run={run}
            isLatest={index === 0}
            onSelect={run.status !== "running" ? () => setOpenRun(run) : null}
          />
        ))}
      </ul>

      {openRun && (
        <AiVisibilityRunDetailModal
          siteId={siteId}
          runId={openRun.id}
          startedAt={openRun.startedAt}
          onClose={() => setOpenRun(null)}
        />
      )}
    </>
  );
}
