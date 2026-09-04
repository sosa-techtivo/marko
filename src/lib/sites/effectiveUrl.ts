/**
 * Registered vs. effective site URL.
 *
 * `sites.url` is the Registered URL — exactly what the user entered. Every
 * crawl always starts there, and it is never overwritten.
 *
 * `sites.effective_url` is the real destination the seed page's fetch
 * actually landed on, after following any redirects, discovered fresh on
 * every successful crawl (see `runSeoAnalysis` in
 * `src/app/dashboard/sites/[slug]/actions.ts`) from data the crawler
 * already persists (`crawl_pages.final_url`, redirect transparency).
 *
 * Both concepts, and the small amount of logic around them, live in this
 * one pure module so the write path and every read path agree on exactly
 * what "effective" means.
 */

/**
 * What to persist as `sites.effective_url` after a successful crawl — the
 * seed page's real final URL. Only ever called from the success branch of
 * `runSeoAnalysis` (a failed crawl never reaches this at all, so there is
 * no "clear on failure" case to express here — that guarantee comes from
 * where this is called, not from this function). Falls back to the
 * registered URL only in the defensive case where a successfully-fetched
 * seed page somehow has no recorded final URL — `fetchPage`'s own
 * contract guarantees this never happens for a successful fetch, but this
 * keeps the function correct on its own terms rather than assuming that.
 */
export function deriveSeedEffectiveUrl(
  seedFinalUrl: string | null,
  registeredUrl: string,
): string {
  return seedFinalUrl ?? registeredUrl;
}

/**
 * The URL to use for anything that should reflect a site's real, currently
 * known destination — Search Console property matching, the Website
 * Preview iframe, its domain label, and its "Visit site" link. Uses the
 * effective URL once a successful crawl has discovered one; falls back to
 * the registered URL for a site that hasn't completed one yet (or whose
 * `effective_url` write itself failed) — identical to today's behavior in
 * either case.
 */
export function resolveEffectiveSiteUrl(site: {
  url: string;
  effective_url: string | null;
}): string {
  return site.effective_url ?? site.url;
}

/**
 * Small, factual note for the site context area when the registered URL
 * and its discovered effective URL genuinely resolve to a different host
 * — e.g. "techtivo.com redirects to www.techtivo.com". Returns `null` when
 * there's nothing meaningfully different to say: no effective URL known
 * yet, either URL fails to parse, or the two share the same hostname (a
 * root path gaining a trailing slash, or a path-only difference, is not
 * treated as a "redirect" worth mentioning here — this is deliberately a
 * small, host-level signal, not a full URL diff).
 */
export function describeRegisteredUrlRedirect(
  registeredUrl: string,
  effectiveUrl: string | null,
): string | null {
  if (!effectiveUrl) return null;

  let registeredHost: string;
  let effectiveHost: string;
  try {
    registeredHost = new URL(registeredUrl).hostname;
    effectiveHost = new URL(effectiveUrl).hostname;
  } catch {
    return null;
  }

  if (registeredHost === effectiveHost) return null;
  return `${registeredHost} redirects to ${effectiveHost}`;
}
