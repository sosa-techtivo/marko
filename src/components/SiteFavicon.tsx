"use client";

import { useState } from "react";

/**
 * Site identity avatar for dashboard cards: the site's discovered favicon
 * when available, falling back to the existing initial-letter circle if
 * there's no favicon URL or it fails to load (never a broken-image icon).
 *
 * Plain <img>, not next/image: favicon URLs point at arbitrary third-party
 * hosts (every crawled site's own domain), and next/image would require
 * allowlisting those hosts in `images.remotePatterns` — effectively
 * allowing arbitrary remote hosts. A plain <img> bypasses Next's image
 * optimizer entirely, so no such allowlist is needed, and no proxy
 * endpoint is introduced just to fetch favicons server-side.
 */
export function SiteFavicon({
  faviconUrl,
  siteName,
}: {
  faviconUrl: string | null;
  siteName: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!faviconUrl || failed) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-tint text-sm font-semibold text-primary-strong">
        {siteName.charAt(0).toUpperCase()}
      </span>
    );
  }

  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-200 bg-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={faviconUrl}
        alt={`${siteName} favicon`}
        className="h-full w-full object-contain p-1.5"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
