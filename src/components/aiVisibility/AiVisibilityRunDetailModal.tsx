"use client";

import { useEffect, useId, useState } from "react";
import {
  getAiVisibilityRunDetail,
  type AiVisibilityResultDetail,
  type AiVisibilityRunDetailResult,
} from "@/app/dashboard/sites/[slug]/ai-visibility/actions";
import { StatusBadge } from "@/components/seoReport/badges";

/** Small tri-state badge for a nullable boolean metric — `null` renders as
 * a distinct "Not evaluated" state rather than being coerced into looking
 * like "No" (CLAUDE.md/this slice's explicit requirement: NULL must stay
 * distinguishable from a genuine negative result). */
function MetricBadge({ label, value }: { label: string; value: boolean | null }) {
  const colors =
    value === true
      ? "border-green-200 bg-green-50 text-green-700"
      : value === false
        ? "border-zinc-300 bg-zinc-100 text-zinc-600"
        : "border-zinc-200 bg-zinc-50 text-zinc-400";
  const text = value === true ? "Yes" : value === false ? "No" : "Not evaluated";

  return (
    <span className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${colors}`}>
      {label}: {text}
    </span>
  );
}

/** The three metrics this slice explicitly does not implement — shown as a
 * clearly-labelled "not yet measured" note so the UI never implies they
 * currently work (see CLAUDE.md's Metrics Explicitly Deferred). */
function DeferredMetricsNote() {
  return (
    <p className="text-[11px] text-zinc-400">
      Recommended, Accuracy, and Sentiment are not yet measured in this release.
    </p>
  );
}

function ResultCard({ result }: { result: AiVisibilityResultDetail }) {
  return (
    <li className="rounded-md border border-zinc-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-zinc-900">{result.questionText}</p>
          {result.category && (
            <span className="mt-1 inline-block rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
              {result.category}
            </span>
          )}
        </div>
        <span
          className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${
            result.status === "completed"
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {result.status === "completed" ? "Completed" : "Failed"}
        </span>
      </div>

      {result.status === "failed" ? (
        <p className="mt-2 text-xs text-red-600">{result.errorMessage ?? "This question could not be answered."}</p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <MetricBadge label="Mentioned" value={result.mentioned} />
            <MetricBadge label="Cited" value={result.cited} />
            {result.firstMentionIndex !== null && (
              <span className="inline-block rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
                First mention at character {result.firstMentionIndex}
              </span>
            )}
          </div>

          <p className="mt-2 whitespace-pre-wrap text-xs text-zinc-700">{result.answerText}</p>

          <div className="mt-2">
            <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">
              Sources ({result.sources.length})
            </p>
            {result.sources.length === 0 ? (
              <p className="mt-1 text-[11px] text-zinc-400">No citation was returned for this answer.</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1">
                {result.sources.map((source, index) => (
                  <li key={`${source.url}-${index}`} className="truncate text-[11px]">
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-primary-strong hover:underline"
                    >
                      {source.title ?? source.url}
                    </a>
                    {source.domain && <span className="ml-1 text-zinc-400">({source.domain})</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </li>
  );
}

export function AiVisibilityRunDetailModal({
  siteId,
  runId,
  startedAt,
  onClose,
}: {
  siteId: string;
  runId: string;
  startedAt: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const [result, setResult] = useState<AiVisibilityRunDetailResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAiVisibilityRunDetail(siteId, runId).then((fetched) => {
      if (!cancelled) setResult(fetched);
    });
    return () => {
      cancelled = true;
    };
  }, [siteId, runId]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 px-4" onClick={handleBackdropClick}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[85vh] w-[85vw] max-w-[900px] flex-col rounded-xl border border-zinc-200 bg-white shadow-lg"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-100 p-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-zinc-900">
              {new Date(startedAt).toLocaleString()}
            </h2>
            {result?.ok && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <StatusBadge status={result.run.status} />
                <span className="text-[11px] text-zinc-500">
                  {result.run.provider} · {result.run.model}
                </span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 text-zinc-400 outline-none hover:bg-zinc-100 hover:text-zinc-600 focus-visible:ring-2 focus-visible:ring-primary"
          >
            <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto p-4">
          {!result ? (
            <p className="py-8 text-center text-xs text-zinc-500">Loading…</p>
          ) : !result.ok ? (
            <p className="py-8 text-center text-xs text-red-600">{result.error}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {result.run.errorMessage && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {result.run.errorMessage}
                </p>
              )}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-xl font-semibold text-zinc-900">{result.run.questionCount}</p>
                  <p className="text-xs text-zinc-500">Questions</p>
                </div>
                <div>
                  <p className="text-xl font-semibold text-zinc-900">{result.run.succeededCount}</p>
                  <p className="text-xs text-zinc-500">Succeeded</p>
                </div>
                <div>
                  <p className="text-xl font-semibold text-zinc-900">{result.run.failedCount}</p>
                  <p className="text-xs text-zinc-500">Failed</p>
                </div>
              </div>

              <DeferredMetricsNote />

              {result.results.length === 0 ? (
                <p className="text-xs text-zinc-500">No results recorded for this run.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {result.results.map((r) => (
                    <ResultCard key={r.id} result={r} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
