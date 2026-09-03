"use client";

import type { ReactNode } from "react";
import { useAnalysisPending } from "./AnalysisPendingContext";

/**
 * Swaps a crawl/report-dependent card's real content for a neutral
 * skeleton while a fresh analysis is running, so "Run SEO analysis"
 * visibly starts refreshing every affected area at once instead of
 * leaving stale numbers on screen with no feedback. Website Preview and
 * Search Console are never wrapped in this — neither depends on the
 * crawl, so both stay exactly as they are throughout the run.
 *
 * `skeleton` defaults to nothing (hides `children` outright) — used for
 * content that has no meaningful placeholder shape of its own, like the
 * "no issues found" positive-signals box, which would be misleading to
 * keep showing (possibly stale) while a new analysis is in flight.
 *
 * Every card driven by this shares the same `isPending` flag (see
 * AnalysisPendingContext), so all of them flip back to real content in
 * the same render the moment the action's transition resolves — an
 * atomic swap, not a staggered one.
 *
 * `children`/`skeleton` are both already-computed content (server-side
 * for the real branch, static markup for the skeleton branch); this
 * component only decides which to show — no business logic, data
 * fetching, or crawl behavior is touched.
 */
export function AnalysisResultSwap({
  skeleton = null,
  children,
}: {
  skeleton?: ReactNode;
  children: ReactNode;
}) {
  const { isPending } = useAnalysisPending();
  return isPending ? <>{skeleton}</> : <>{children}</>;
}
