import { Skeleton } from "@/components/Skeleton";

/**
 * Neutral placeholder for the Analysis History list while a fresh analysis
 * is running (see AnalysisResultSwap in page.tsx) — the list is about to
 * gain a new "Latest" row and shift, so it's skeletonized rather than left
 * showing the pre-refresh history. Keeps the card's real heading (static
 * UI copy, not crawl data).
 */
export function AnalysisHistorySkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="shrink-0 text-xs font-semibold text-zinc-900">Analysis history</h2>
      <div className="mt-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-2 px-2 py-2">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="mt-1.5 h-3 w-20" />
            </div>
            <Skeleton className="h-4 w-14 shrink-0 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
