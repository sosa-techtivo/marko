/**
 * Matches a MARKO site's registered URL against the Search Console
 * properties available to the connected Google account, and decides
 * whether there's exactly one clear, deterministic exact match worth
 * auto-selecting. Pure and synchronous — no network/DB access — so this
 * can be unit tested directly and reused from both the property-listing
 * Server Action and its tests.
 *
 * Search Console properties come in two shapes:
 *  - URL-prefix: any URL, e.g. "https://example.com/" or
 *    "https://example.com/blog/" — always returned with a trailing slash.
 *  - Domain: "sc-domain:example.com" — covers every protocol/subdomain
 *    under that root domain.
 *
 * Deliberately conservative: only an exact, unambiguous match is ever
 * auto-selected. Anything else (zero matches, or more than one — e.g. a
 * domain property AND a url-prefix property both plausibly matching) is
 * left for the user to pick from the full list.
 */

export type SearchConsolePropertyType = "url_prefix" | "domain";

export type SearchConsoleProperty = {
  siteUrl: string;
  permissionLevel: string;
};

export type MatchedProperty = {
  siteUrl: string;
  type: SearchConsolePropertyType;
};

function classifyPropertyType(siteUrl: string): SearchConsolePropertyType {
  return siteUrl.startsWith("sc-domain:") ? "domain" : "url_prefix";
}

/** Normalizes a URL-prefix property/site URL for exact comparison: strips
 * the fragment and guarantees a trailing slash (GSC always includes one on
 * its own url-prefix properties, but a site's own registered URL may not).
 * Scheme and host case are left as-is — GSC treats http/https url-prefix
 * properties as genuinely distinct, and an exact match should stay exact. */
function normalizeUrlPrefix(url: string): string | null {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    if (!parsed.pathname.endsWith("/")) {
      parsed.pathname = `${parsed.pathname}/`;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function stripLeadingWww(hostname: string): string {
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

/**
 * Returns the single exact-match property for `siteUrl`, or `null` if
 * there isn't exactly one (no matches, or more than one candidate).
 */
export function findExactPropertyMatch(
  siteUrl: string,
  properties: SearchConsoleProperty[],
): MatchedProperty | null {
  const siteHostname = extractHostname(siteUrl);
  const normalizedSitePrefix = normalizeUrlPrefix(siteUrl);
  if (!siteHostname || !normalizedSitePrefix) return null;

  const siteRootDomain = stripLeadingWww(siteHostname);

  const matches = new Map<string, MatchedProperty>();
  for (const property of properties) {
    const type = classifyPropertyType(property.siteUrl);

    if (type === "url_prefix") {
      const normalizedPropertyPrefix = normalizeUrlPrefix(property.siteUrl);
      if (normalizedPropertyPrefix === normalizedSitePrefix) {
        matches.set(`url_prefix:${normalizedPropertyPrefix}`, { siteUrl: property.siteUrl, type });
      }
    } else {
      const domain = property.siteUrl.slice("sc-domain:".length).toLowerCase();
      if (domain === siteRootDomain) {
        matches.set(`domain:${domain}`, { siteUrl: property.siteUrl, type });
      }
    }
  }

  return matches.size === 1 ? [...matches.values()][0] : null;
}
