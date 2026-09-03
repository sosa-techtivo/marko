import { Skeleton } from "@/components/Skeleton";

/**
 * Neutral placeholder for ChangesSinceLastAnalysisCard's data area (the
 * "Comparing X to Y" line, resolved/new/remaining stats, and preview rows)
 * — shown while a fresh analysis is running (see AnalysisResultSwap in
 * page.tsx). Keeps the card's real heading (static UI copy, not crawl
 * data) so the card is still identifiable while its numbers refresh.
 */
export function ChangesCardSkeleton() {
  return (
    <div className="flex h-full flex-col rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-xs font-semibold text-zinc-900">Changes Since Last Analysis</h2>
      <Skeleton className="mt-1 h-3 w-48" />
      <Skeleton className="mt-2 h-3 w-32" />

      <div className="mt-2 grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1">
            <Skeleton className="h-4 w-8" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>

      <div className="mt-3 border-t border-zinc-100 pt-2">
        <ul className="divide-y divide-zinc-100">
          {Array.from({ length: 2 }).map((_, i) => (
            <li key={i} className="flex items-center gap-1.5 py-1.5">
              <Skeleton className="h-3.5 w-12 rounded-md" />
              <Skeleton className="h-3.5 w-14 rounded-md" />
              <Skeleton className="h-3 w-24" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
