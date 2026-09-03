"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

/**
 * Desktop-only mechanism that lets MARKO Insights — and only MARKO
 * Insights — cap its height to Website Preview's own *rendered* height,
 * without any CSS grid/flex stretching relationship between them
 * (stretching would let Insights' content pull Preview taller, or pull
 * unrelated cards into the same height — exactly what this avoids). The
 * dependency is strictly one-way: PreviewHeightMeasuredBox only ever
 * *reads* Preview's box size via ResizeObserver (the same API
 * WebsitePreviewCard already uses for its own scale factor — no new
 * technique introduced) and publishes it through context; nothing here
 * writes back to Preview or the element that measures it, so no amount of
 * Insights content can ever make Preview taller. No other card (Current
 * SEO Health included) reads from this — it is scoped to Insights alone.
 *
 * - PreviewHeightMatchProvider: wraps the 3-column dashboard area, holds
 *   the measured height and whether the viewport is currently desktop
 *   (the `lg` breakpoint — tracked directly via matchMedia, not inferred
 *   from the measurement, so the constraint is reliably absent below it
 *   even before anything has been measured).
 * - PreviewHeightMeasuredBox: a transparent wrapper placed directly around
 *   WebsitePreviewCard — the ResizeObserver target. Adds no sizing/visual
 *   styling of its own, so Preview's own presentation is unaffected.
 * - usePreviewMaxHeight(): the current cap in pixels, or `null` when none
 *   should be applied (not yet measured, or below `lg`) — the consumer
 *   (MarkoInsightsCard) must render unconstrained in that case.
 */

const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)"; // Tailwind's `lg` breakpoint

type PreviewHeightContextValue = {
  previewRef: RefObject<HTMLDivElement | null>;
  maxHeight: number | null;
};

const PreviewHeightContext = createContext<PreviewHeightContextValue | null>(null);

export function PreviewHeightMatchProvider({ children }: { children: ReactNode }) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  // Lazy initializer (not an effect) so the very first client render
  // already has the right value where possible; guarded for SSR, where
  // `window` doesn't exist — harmless since `measuredHeight` is also
  // still `null` at that point either way, so `maxHeight` comes out the
  // same (`null`) on the server and the first client render regardless.
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia(DESKTOP_MEDIA_QUERY).matches,
  );
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_MEDIA_QUERY);
    function handleChange(event: MediaQueryListEvent) {
      setIsDesktop(event.matches);
    }
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  // Re-measures on every resize of Preview's own rendered box — covers
  // viewport-width changes (Preview's aspect-ratio scaling) and any other
  // reason its box might change, generically, without hardcoding a cause.
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height) setMeasuredHeight(height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const value: PreviewHeightContextValue = {
    previewRef,
    maxHeight: isDesktop ? measuredHeight : null,
  };

  return <PreviewHeightContext.Provider value={value}>{children}</PreviewHeightContext.Provider>;
}

function usePreviewHeightContext(): PreviewHeightContextValue {
  const ctx = useContext(PreviewHeightContext);
  if (!ctx) {
    throw new Error("PreviewHeightMatch: must be used within a PreviewHeightMatchProvider");
  }
  return ctx;
}

/** Transparent measurement target — place directly around
 * WebsitePreviewCard. No styling of its own, so it cannot affect Preview's
 * rendered size or appearance. */
export function PreviewHeightMeasuredBox({ children }: { children: ReactNode }) {
  const { previewRef } = usePreviewHeightContext();
  return <div ref={previewRef}>{children}</div>;
}

/** Current desktop height cap in pixels, or `null` when none should be
 * applied (not yet measured, or the viewport is below the `lg`
 * breakpoint). Used only by MarkoInsightsCard. */
export function usePreviewMaxHeight(): number | null {
  return usePreviewHeightContext().maxHeight;
}
