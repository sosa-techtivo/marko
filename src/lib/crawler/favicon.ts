import { extractFaviconHref } from "./html";

/**
 * Resolves the site's favicon URL from the crawl's start-page HTML, for
 * dashboard display only — not an SEO signal, not a per-page finding.
 *
 * No new network request: works purely off HTML the crawler already
 * fetched, plus simple URL resolution. Only ever returns an http(s) URL
 * (rejects any other scheme a declared favicon href might use, e.g.
 * `data:`/`javascript:`), consistent with treating favicon URLs as
 * untrusted remote content.
 */
function isHttpUrl(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

export function resolveFaviconUrl(html: string, pageUrl: URL): string | null {
  const href = extractFaviconHref(html);
  if (href) {
    const trimmed = href.trim();
    if (trimmed.length > 0) {
      try {
        const resolved = new URL(trimmed, pageUrl);
        if (isHttpUrl(resolved)) {
          return resolved.toString();
        }
      } catch {
        // Not a resolvable URL — fall through to the conventional default.
      }
    }
  }

  // No favicon explicitly declared (or it didn't resolve to something
  // usable) — the conventional origin default is a reasonable candidate;
  // the dashboard falls back to the initial-letter avatar if it 404s.
  const fallback = new URL("/favicon.ico", pageUrl);
  return isHttpUrl(fallback) ? fallback.toString() : null;
}
