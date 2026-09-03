"use client";

import { useAnalysisPending } from "./AnalysisPendingContext";

/**
 * Replaces the plain `<form action={runSeoAnalysis}>` submit button with
 * one that shares pending state (via AnalysisPendingContext) with the
 * Current SEO Health card, so both react to the same in-flight analysis —
 * this button disables and relabels itself, the health card swaps to a
 * skeleton (see AnalysisResultSwap). Submission is handled directly rather
 * than through a native form `action` since `useFormStatus` couldn't reach
 * the health card anyway; both consumers read the one shared signal
 * instead.
 */
export function RunAnalysisButton({ siteId }: { siteId: string }) {
  const { isPending, run } = useAnalysisPending();

  function handleClick() {
    const formData = new FormData();
    formData.set("siteId", siteId);
    run(formData);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-busy={isPending}
      className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isPending ? "Analyzing…" : "Run SEO analysis"}
    </button>
  );
}
