"use client";

import { useEffect, useRef, useState } from "react";
import { SiteFavicon } from "@/components/SiteFavicon";

// If the iframe hasn't fired `onLoad` within this window, the preview is
// treated the same as a confirmed embedding block: the fallback renders and
// the iframe is unmounted, rather than ever leaving a stalled/blank frame
// on screen.
const LOAD_TIMEOUT_MS = 7_000;

// Rendered at this fixed desktop size, then scaled down with CSS transform
// to fit the card — the standard technique for a Vercel-style "mini"
// preview, since most sites don't have a layout meant to fit a narrow
// sidebar card at 1:1 size.
const PREVIEW_WIDTH = 1280;
const PREVIEW_HEIGHT = 800;

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

function PreviewFallback({
  siteName,
  url,
  faviconUrl,
}: {
  siteName: string;
  url: string;
  faviconUrl: string | null;
}) {
  return (
    <PreviewChrome url={url}>
      <div className="flex aspect-video flex-col items-center justify-center gap-3 bg-zinc-50 px-4 text-center">
        <SiteFavicon faviconUrl={faviconUrl} siteName={siteName} />
        <div>
          <p className="text-sm font-medium text-zinc-700">Preview unavailable</p>
          <p className="mt-0.5 text-xs text-zinc-500">{domainOf(url)}</p>
        </div>
      </div>
    </PreviewChrome>
  );
}

/**
 * Vercel-inspired mini preview of the client's live site. `canEmbed` is a
 * server-side, header-based check (see checkSiteEmbeddable) of whether the
 * site allows being framed — when it doesn't, the iframe is never mounted
 * at all and this renders the fallback directly.
 *
 * Even when `canEmbed` is true, cross-origin restrictions mean the iframe's
 * `onLoad` can't fully distinguish "rendered fine" from some blocked/broken
 * states, so a load timeout backstops the header check: if the frame
 * doesn't report loaded in time, the fallback replaces it rather than ever
 * leaving a blank or broken iframe visible.
 */
export function WebsitePreviewCard({
  siteName,
  url,
  faviconUrl,
  canEmbed,
}: {
  siteName: string;
  url: string;
  faviconUrl: string | null;
  canEmbed: boolean;
}) {
  const [status, setStatus] = useState<"loading" | "loaded" | "blocked">(
    canEmbed ? "loading" : "blocked",
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
    timeoutRef.current = setTimeout(() => setStatus("blocked"), LOAD_TIMEOUT_MS);
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

  if (status === "blocked") {
    return <PreviewFallback siteName={siteName} url={url} faviconUrl={faviconUrl} />;
  }

  return (
    <PreviewChrome url={url}>
      <div
        ref={containerRef}
        className="relative overflow-hidden bg-zinc-50"
        style={{ paddingTop: `${(PREVIEW_HEIGHT / PREVIEW_WIDTH) * 100}%` }}
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
              setStatus("blocked");
            }}
          />
        )}
      </div>
    </PreviewChrome>
  );
}
