import { Skeleton } from "@/components/Skeleton";

/**
 * Neutral placeholder for the SEO progress chart while a fresh analysis is
 * running (see AnalysisResultSwap in page.tsx) — the chart necessarily
 * changes once the new run is persisted (a new point is added), so it's
 * skeletonized like the other crawl-dependent cards rather than left
 * showing the pre-refresh trend. Keeps the card's real heading (static UI
 * copy, not crawl data).
 */
export function ProgressCardSkeleton() {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-xs font-semibold text-zinc-900">SEO progress</h2>
      <Skeleton className="mt-1.5 h-3 w-40" />
      <Skeleton className="mt-2 h-24 w-full" />
    </div>
  );
}
