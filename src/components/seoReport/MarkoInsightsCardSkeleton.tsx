"use client";

import { Skeleton } from "@/components/Skeleton";
import { usePreviewMaxHeight } from "./PreviewHeightMatch";

/**
 * Neutral placeholder for MARKO Insights while a fresh analysis is running
 * (see AnalysisResultSwap in page.tsx) — same wrapper/height-cap behavior
 * as the real MarkoInsightsCard (`usePreviewMaxHeight`, unchanged since
 * Website Preview itself keeps rendering normally throughout the run), so
 * swapping in and back out doesn't shift the row's height. Keeps the
 * card's real heading (static UI copy, not crawl data).
 */
export function MarkoInsightsCardSkeleton() {
  const maxHeight = usePreviewMaxHeight();

  return (
    <div
      className="flex shrink-0 flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white p-4"
      style={maxHeight !== null ? { maxHeight } : undefined}
    >
      <h2 className="shrink-0 text-xs font-semibold text-zinc-900">MARKO Insights</h2>
      <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="border-t border-zinc-100 pt-2.5 first:border-t-0 first:pt-0">
            <Skeleton className="h-3 w-16 rounded-full" />
            <Skeleton className="mt-1.5 h-3 w-3/4" />
            <Skeleton className="mt-1 h-3 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
