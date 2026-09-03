import { Skeleton } from "@/components/Skeleton";
import { HealthCardSkeleton } from "./HealthCardSkeleton";

/**
 * Full-page approximation of the site detail dashboard's 3-column layout,
 * shown by `loading.tsx` while the destination route is still loading (a
 * fresh navigation — e.g. clicking a site card — not a live "Run SEO
 * analysis" on an already-loaded page; see AnalysisResultSwap for that).
 * Reuses the exact same card wrapper classes (border/rounding/padding/gap)
 * as the real cards so the page doesn't visibly jump when the real content
 * mounts; everything inside each card is a neutral pulsing block, never a
 * real number, finding, or label. No interactivity/hooks needed here, so
 * this stays a plain Server Component like every other `loading.tsx`.
 */
export function SiteDetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <span className="sr-only">Loading site…</span>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-7 w-32 shrink-0 rounded-md" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Column 1: SEO Health / Changes / Progress */}
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-5 w-16 rounded-md" />
            </div>
            <HealthCardSkeleton />
          </div>

          <div className="flex h-full flex-col rounded-lg border border-zinc-200 bg-white p-4">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="mt-2 h-3 w-56" />
            <div className="mt-2 grid grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-1">
                  <Skeleton className="h-4 w-8" />
                  <Skeleton className="h-3 w-14" />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-24 w-full" />
          </div>
        </div>

        {/* Column 2: MARKO Insights / Analysis History */}
        <div className="flex h-full min-h-0 flex-col gap-4">
          <div className="flex shrink-0 flex-col rounded-lg border border-zinc-200 bg-white p-4">
            <Skeleton className="h-3 w-28" />
            <div className="mt-2 flex flex-col gap-2.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="border-t border-zinc-100 pt-2.5 first:border-t-0 first:pt-0"
                >
                  <Skeleton className="h-3 w-16 rounded-full" />
                  <Skeleton className="mt-1.5 h-3 w-3/4" />
                  <Skeleton className="mt-1 h-3 w-full" />
                </div>
              ))}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-zinc-200 bg-white p-4">
            <Skeleton className="h-3 w-28" />
            <div className="mt-2 flex flex-col gap-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-2 py-2">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-4 w-14 rounded-md" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Column 3: Website Preview / Search Console */}
        <div className="flex flex-col gap-4">
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-2">
              <Skeleton className="h-2.5 w-2.5 rounded-full" />
              <Skeleton className="h-2.5 w-2.5 rounded-full" />
              <Skeleton className="h-2.5 w-2.5 rounded-full" />
              <Skeleton className="ml-1 h-3 w-24" />
            </div>
            <Skeleton className="aspect-[1440/900] w-full rounded-none" />
            <div className="border-t border-zinc-200 px-3 py-2">
              <Skeleton className="h-3 w-16" />
            </div>
          </div>

          <div className="rounded-lg border border-zinc-100 bg-white p-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-3 w-48" />
          </div>
        </div>
      </div>
    </div>
  );
}
