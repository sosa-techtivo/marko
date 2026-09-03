/**
 * Minimal, reusable loading-placeholder primitive: a neutral pulsing block,
 * sized entirely by the caller via `className` (width/height/rounding —
 * this component adds no dimensions of its own). Respects
 * prefers-reduced-motion (`motion-reduce:animate-none` drops the pulse,
 * leaving a static placeholder) and is marked `aria-hidden` — it carries no
 * content of its own, so nothing here should be announced to assistive
 * tech; the loading region around it is responsible for its own
 * `aria-busy`/`sr-only` label (see SiteDetailSkeleton/SitesGridSkeleton).
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-zinc-200 motion-reduce:animate-none ${className}`}
    />
  );
}
