import { Skeleton } from "./Skeleton";

/** Approximates one SiteCard (see SitesGrid.tsx) — same wrapper/spacing
 * classes, neutral pulsing blocks instead of real favicon/name/status/
 * gauge/stats/footer content. */
function SiteCardSkeleton() {
  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex min-w-0 items-center gap-2.5">
        <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="mt-1.5 h-3 w-1/2" />
        </div>
      </div>

      <div className="mt-1.5">
        <Skeleton className="h-5 w-24 rounded-full" />
      </div>

      <div className="mt-2 border-t border-zinc-100 pt-2">
        <div className="flex justify-center">
          <Skeleton className="h-[50px] w-[98px] rounded-full" />
        </div>
        <div className="mt-1 grid grid-cols-3 gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <Skeleton className="h-3.5 w-6" />
              <Skeleton className="h-2.5 w-10" />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-auto pt-2">
        <div className="border-t border-zinc-100 pt-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-1.5 h-3 w-16" />
        </div>
      </div>
    </div>
  );
}

/**
 * Neutral placeholder approximating the Sites dashboard's header + search/
 * filter row + card grid, shown by `/dashboard/loading.tsx` during route
 * navigation. Same responsive grid classes as the real SitesGrid so the
 * layout doesn't jump once real cards mount; card count (8) is just enough
 * to fill two rows at the widest (`lg:grid-cols-4`) breakpoint.
 */
export function SitesGridSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only">Loading sites…</span>

      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-6 w-24" />
          <Skeleton className="mt-2 h-3.5 w-56" />
        </div>
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Skeleton className="h-9 flex-1 rounded-md" />
        <Skeleton className="h-9 w-full rounded-md sm:w-56" />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <SiteCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
