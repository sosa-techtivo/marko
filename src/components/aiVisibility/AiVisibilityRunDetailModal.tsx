"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import {
  getAiVisibilityRunDetail,
  type AiVisibilityResultDetail,
  type AiVisibilityRunDetailResult,
} from "@/app/dashboard/sites/[slug]/ai-visibility/actions";
import { StatusBadge } from "@/components/seoReport/badges";
import { ExecutionMethodBadge } from "./ExecutionMethodBadge";
import { MetricBadge } from "./MetricBadge";
import { aiVisibilityProviderLabel } from "@/lib/aiVisibility/providerLabels";
import { siteAiVisibilityResultPath } from "@/lib/sites/paths";
import {
  formatProviderSummaries,
  groupResultsByQuestion,
  summarizeResultsByProvider,
} from "@/lib/aiVisibility/runDetail";

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

function KpiTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1">
      <p className="text-sm font-semibold text-zinc-900">{value}</p>
      <p className="text-[11px] text-zinc-500">{label}</p>
    </div>
  );
}

/** One provider's result as a compact KPI card — Mentioned/Cited,
 * competitor and source counts, the competitor list, and a link to the
 * provider result detail page. The full answer is never rendered here. A
 * failed result shows only its own error, never placeholder KPIs. */
function ProviderResultCard({
  result,
  executionMethod,
  siteSlug,
}: {
  result: AiVisibilityResultDetail;
  executionMethod: string;
  siteSlug: string;
}) {
  const failed = result.status !== "completed";
  return (
    <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-900">{aiVisibilityProviderLabel(result.provider, executionMethod)}</p>
          <p className="truncate text-[11px] text-zinc-400">{result.model}</p>
        </div>
        <span
          className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${
            failed ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-700"
          }`}
        >
          {failed ? "Failed" : "Completed"}
        </span>
      </div>

      {failed ? (
        <p className="text-xs text-red-600">{result.errorMessage ?? "This question could not be answered."}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <MetricBadge label="Mentioned" value={result.mentioned} />
            <MetricBadge label="Cited" value={result.cited} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <KpiTile label="Competitors found" value={result.competitors?.length ?? 0} />
            <KpiTile label="Sources" value={result.sourceCount ?? 0} />
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Competitors</p>
            {result.competitors && result.competitors.length > 0 ? (
              <ul className="mt-1 flex flex-wrap gap-1">
                {result.competitors.map((competitor) => (
                  <li
                    key={competitor}
                    className="rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] text-zinc-700"
                  >
                    {competitor}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[11px] text-zinc-400">No competitor companies identified in this answer.</p>
            )}
          </div>
        </>
      )}

      <Link
        href={siteAiVisibilityResultPath(siteSlug, result.id)}
        className="self-start text-xs font-medium text-primary-strong hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        View details →
      </Link>
    </div>
  );
}

/** One question with each provider's result in its own card (one card for
 * API runs; for Browser runs, Gemini/ChatGPT/Perplexity/Claude in a 2×2
 * grid — four narrow columns would hurt readability — stacking on narrow
 * screens). */
function QuestionResultCard({
  results,
  executionMethod,
  siteSlug,
}: {
  results: AiVisibilityResultDetail[];
  executionMethod: string;
  siteSlug: string;
}) {
  const first = results[0];
  return (
    <li className="rounded-md border border-zinc-200 p-3">
      <p className="text-xs font-medium text-zinc-900">{first.questionText}</p>
      {first.category && (
        <span className="mt-1 inline-block rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
          {first.category}
        </span>
      )}
      <div
        className={`mt-3 grid grid-cols-1 gap-3 ${
          results.length === 3 ? "md:grid-cols-2 lg:grid-cols-3" : results.length > 1 ? "md:grid-cols-2" : ""
        }`}
      >
        {results.map((result) => (
          <ProviderResultCard key={result.id} result={result} executionMethod={executionMethod} siteSlug={siteSlug} />
        ))}
      </div>
    </li>
  );
}

export function AiVisibilityRunDetailModal({
  siteId,
  siteSlug,
  runId,
  startedAt,
  onClose,
}: {
  siteId: string;
  siteSlug: string;
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
                <ExecutionMethodBadge method={result.run.executionMethod} />
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
                  <p className="text-xs text-zinc-500">
                    {result.run.executionMethod === "browser" ? "Provider results succeeded" : "Succeeded"}
                  </p>
                </div>
                <div>
                  <p className="text-xl font-semibold text-zinc-900">{result.run.failedCount}</p>
                  <p className="text-xs text-zinc-500">
                    {result.run.executionMethod === "browser" ? "Provider results failed" : "Failed"}
                  </p>
                </div>
              </div>

              {result.run.executionMethod === "browser" && result.results.length > 0 && (
                <p className="text-xs text-zinc-600">
                  By provider:{" "}
                  {formatProviderSummaries(summarizeResultsByProvider(result.results, result.run.executionMethod))}{" "}
                  succeeded
                </p>
              )}

              <DeferredMetricsNote />

              {result.results.length === 0 ? (
                <p className="text-xs text-zinc-500">No results recorded for this run.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {groupResultsByQuestion(result.results).map((group) => (
                    <QuestionResultCard
                      key={group.questionId}
                      results={group.results}
                      executionMethod={result.run.executionMethod}
                      siteSlug={siteSlug}
                    />
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
