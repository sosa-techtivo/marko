"use client";

import { useEffect, useRef, useState } from "react";
import { SiteFavicon } from "@/components/SiteFavicon";
import type { EmbedCheckResult } from "@/lib/preview/checkEmbeddable";

// If the iframe hasn't fired `onLoad` within this window, the preview is
// treated the same as a confirmed embedding block: the fallback renders and
// the iframe is unmounted, rather than ever leaving a stalled/blank frame
// on screen.
const LOAD_TIMEOUT_MS = 7_000;

// The full virtual desktop viewport the live site renders into, then gets
// scaled down with CSS transform (transform-origin top-left, width/height
// compensated by the same scale factor) to fit the card — the standard
// technique for a Vercel-style "mini" preview. `scale` (below) is always
// `containerWidth / PREVIEW_WIDTH`, and the wrapper's own height is that
// exact same ratio applied to PREVIEW_HEIGHT (via the aspect-ratio class
// just below, which is mathematically the same computation expressed in
// CSS instead of JS) — so the *whole* PREVIEW_WIDTH x PREVIEW_HEIGHT
// viewport always fits inside the wrapper with nothing cropped off the
// bottom or right, at any card width.
const PREVIEW_WIDTH = 1440;
const PREVIEW_HEIGHT = 900;

// Wrapper sizing: full width, height = width * (PREVIEW_HEIGHT /
// PREVIEW_WIDTH) — i.e. exactly the scaled height of the iframe above, so
// nothing is clipped. Using the CSS `aspect-ratio` property (rather than
// setting a JS-computed pixel height from `scale`) means this is correct
// from the very first paint, with no dependency on the ResizeObserver
// below having measured anything yet — no 0-height flash, no mismatch.
// Applied identically to the fallback card so neither preview state is a
// different height. Written as a literal string, not interpolated from
// the numeric constants above: Tailwind's build-time scanner only picks up
// arbitrary-value classes it can find verbatim in source.
const PREVIEW_ASPECT_RATIO_CLASS = "aspect-[1440/900]";

function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function PreviewChrome({
  url,
  children,
}: {
  url: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-2">
        <span className="flex gap-1" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-300" />
        </span>
        <span className="truncate text-xs text-zinc-500">{domainOf(url)}</span>
      </div>
      {children}
      <div className="border-t border-zinc-200 px-3 py-2">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-primary-strong hover:underline"
        >
          Visit site →
        </a>
      </div>
    </div>
  );
}

/**
 * `reason` distinguishes a *confirmed* framing restriction (the site's own
 * X-Frame-Options/CSP `frame-ancestors` header, read server-side) from any
 * other preview failure (fetch error, timeout, a client-side iframe load
 * that never confirmed) — only the former gets the more specific
 * "doesn't allow embedded previews" copy; everything else keeps the
 * original generic fallback.
 */
function PreviewFallback({
  siteName,
  url,
  faviconUrl,
  reason,
}: {
  siteName: string;
  url: string;
  faviconUrl: string | null;
  reason: "blocked" | "unavailable";
}) {
  return (
    <PreviewChrome url={url}>
      <div
        className={`flex ${PREVIEW_ASPECT_RATIO_CLASS} flex-col items-center justify-center gap-3 bg-zinc-50 px-4 text-center`}
      >
        <SiteFavicon faviconUrl={faviconUrl} siteName={siteName} />
        <div>
          <p className="text-sm font-medium text-zinc-700">Preview unavailable</p>
          {reason === "blocked" && (
            <p className="mt-0.5 text-xs text-zinc-500">
              This site does not allow embedded previews.
            </p>
          )}
          <p className="mt-0.5 text-xs text-zinc-500">{domainOf(url)}</p>
        </div>
      </div>
    </PreviewChrome>
  );
}

/**
 * Vercel-inspired mini preview of the client's live site. `embedStatus` is
 * the server-side, header-based check (see checkSiteEmbeddable) of whether
 * the site allows being framed — when it's anything other than
 * "embeddable", the iframe is never mounted at all and this renders the
 * fallback directly, with "blocked" (a confirmed X-Frame-Options/CSP
 * restriction) getting more specific copy than a generic "unavailable".
 *
 * Even when `embedStatus` is "embeddable", cross-origin restrictions mean
 * the iframe's `onLoad` can't fully distinguish "rendered fine" from some
 * blocked/broken state, so a load timeout backstops the header check: if
 * the frame doesn't report loaded in time, the fallback replaces it rather
 * than ever leaving a blank or broken iframe visible. That client-side
 * failure is never confirmed as a framing restriction, so it always falls
 * back to the generic "unavailable" copy, never "blocked".
 */
export function WebsitePreviewCard({
  siteName,
  url,
  faviconUrl,
  embedStatus,
}: {
  siteName: string;
  url: string;
  faviconUrl: string | null;
  embedStatus: EmbedCheckResult;
}) {
  const canEmbed = embedStatus === "embeddable";
  const [status, setStatus] = useState<"loading" | "loaded" | "blocked" | "unavailable">(
    canEmbed ? "loading" : embedStatus,
  );
  // Scale factor to shrink the fixed-size iframe down to the card's actual
  // (responsive) width — measured client-side since that width isn't known
  // upfront. 0 means "not measured yet"; the iframe stays unmounted until
  // then so it's never briefly visible at full desktop size.
  const [scale, setScale] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!canEmbed) return;
    // A client-side load failure/timeout was never confirmed as a framing
    // restriction (unlike the server-side header check), so it always
    // resolves to the generic fallback, not "blocked".
    timeoutRef.current = setTimeout(() => setStatus("unavailable"), LOAD_TIMEOUT_MS);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [canEmbed]);

  useEffect(() => {
    if (!canEmbed) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setScale(width / PREVIEW_WIDTH);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [canEmbed]);

  if (status === "blocked" || status === "unavailable") {
    return (
      <PreviewFallback siteName={siteName} url={url} faviconUrl={faviconUrl} reason={status} />
    );
  }

  return (
    <PreviewChrome url={url}>
      <div
        ref={containerRef}
        className={`relative ${PREVIEW_ASPECT_RATIO_CLASS} overflow-hidden bg-zinc-50`}
      >
        {status === "loading" && (
          <div className="absolute inset-0 animate-pulse bg-zinc-100" aria-hidden="true" />
        )}
        {scale > 0 && (
          <iframe
            src={url}
            title={`Preview of ${siteName}`}
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="no-referrer"
            loading="lazy"
            // Legacy but still universally honored by browsers, and unlike
            // CSS it works even though the framed document is cross-origin
            // (we can't inject scrollbar-hiding CSS into someone else's
            // page): suppresses the iframe's own native scrollbar for a
            // page taller than PREVIEW_HEIGHT, so none shows up (scaled
            // along with everything else) inside the preview.
            scrolling="no"
            className="pointer-events-none absolute top-0 left-0 border-0"
            style={{
              width: PREVIEW_WIDTH,
              height: PREVIEW_HEIGHT,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
            onLoad={() => {
              if (timeoutRef.current) clearTimeout(timeoutRef.current);
              setStatus("loaded");
            }}
            onError={() => {
              if (timeoutRef.current) clearTimeout(timeoutRef.current);
              setStatus("unavailable");
            }}
          />
        )}
      </div>
    </PreviewChrome>
  );
}
