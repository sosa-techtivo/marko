import { Skeleton } from "@/components/Skeleton";

/**
 * Neutral placeholder for the Current SEO Health card's data area (gauge +
 * status line + 4-stat grid) — shown in place of the real content while a
 * fresh analysis is running (see AnalysisResultSwap) or before the
 * destination page has loaded at all (see SiteDetailSkeleton). No numbers,
 * no real labels, plain pulsing blocks only — shaped/sized to match the
 * real markup (SiteHealthGauge, HealthIndicator, SummaryStat) so the card's
 * height doesn't jump when real content replaces it.
 */
export function HealthCardSkeleton() {
  return (
    <div>
      <div className="mt-2 flex items-center gap-3">
        <Skeleton className="h-[50px] w-[98px] shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="mt-1.5 h-3 w-40" />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-zinc-100 pt-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1">
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
