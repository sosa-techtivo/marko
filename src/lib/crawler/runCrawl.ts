import { fetchPage } from "./fetchPage";
import {
  extractCanonical,
  extractFirstH1,
  extractH1Count,
  extractImages,
  extractJsonLdBlocks,
  extractLinkHrefs,
  extractMetaContent,
  extractTitle,
} from "./html";
import { analyzePage, type AnalyzedPage } from "./analyze";
import { applyCrossPageChecks } from "./crossPageChecks";
import { resolveFaviconUrl } from "./favicon";
import { formatBotProtectionErrorMessage } from "./botProtection";
import { fetchRobotsTxt, isPathBlocked, type RobotsGroup } from "./robotsTxt";

/**
 * MVP crawl limit: the start URL plus up to this many same-site internal
 * links found on the start page itself. Deliberately 1-level breadth-first
 * (links found on the *additional* pages are not followed) — this keeps a
 * manual, in-request crawl bounded, predictable, and (see
 * FETCH_CONCURRENCY below) safely fast enough to fit the page's existing
 * `maxDuration = 60` budget.
 */
export const MAX_ADDITIONAL_PAGES = 19;
export const MAX_PAGES_PER_CRAWL = 1 + MAX_ADDITIONAL_PAGES;

/**
 * How many *additional* pages (never the seed page, which is always
 * fetched alone first) are fetched at once. `fetchPage` has no shared
 * mutable state and each call is independently SSRF-checked/timed-out, so
 * running a small batch concurrently is safe — it's the only way to keep
 * a 20-page crawl's worst-case wall-clock time inside the existing
 * `maxDuration = 60` budget (see `src/app/dashboard/sites/[slug]/page.tsx`)
 * without shortening `fetchPage`'s existing 8s-per-page timeout (which
 * would make genuinely-slow-but-valid pages more likely to be
 * misreported as unreachable).
 *
 * Worst case with this value: the seed page (up to 8s) + ceil(19/5) = 4
 * batches of the 8s per-fetch timeout ≈ 8 + 32 = 40s — the same worst-case
 * total the *previous* 5-page-sequential crawl already had (5 × 8s = 40s),
 * just spread across up to 20 pages instead of 5. Deliberately modest, not
 * "as parallel as possible" — just enough to make the larger page cap safe
 * within the current architecture.
 */
const FETCH_CONCURRENCY = 5;

const NON_HTML_EXTENSIONS = [
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".svg",
  ".webp",
  ".ico",
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".xml",
  ".zip",
  ".rar",
  ".mp4",
  ".mp3",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
];

function looksLikeNonHtmlAsset(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return NON_HTML_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Conservative, crawl-time-only URL normalization used purely to decide
 * whether two discovered links point at "the same page" (so the same URL
 * variant isn't crawled twice) — never a general canonicalization tool.
 * Only two things are normalized, both near-universally safe:
 *  - the fragment (`#...`) — never changes what's served, so it can never
 *    distinguish two genuinely different pages;
 *  - a single trailing slash on a *non-root* path (`/about/` -> `/about`)
 *    — an established web convention where both forms almost always serve
 *    the same resource.
 * Deliberately does NOT touch query strings, casing, or anything else:
 * those can and often do represent genuinely different content (e.g.
 * `?page=2`, `?id=123`), so merging them would risk silently dropping
 * distinct pages from the crawl rather than just avoiding a re-fetch.
 */
function normalizeForDedup(url: URL): string {
  const normalized = new URL(url.toString());
  normalized.hash = "";
  if (normalized.pathname.length > 1 && normalized.pathname.endsWith("/")) {
    normalized.pathname = normalized.pathname.slice(0, -1);
  }
  return normalized.toString();
}

/**
 * Same-host, http(s), non-asset links found in `html`, deduped against each
 * other by `normalizeForDedup`'s equivalence rule — but each kept link is
 * returned in the literal form the page actually links to (fragment
 * stripped, since a fragment is never sent to the server and two links
 * differing only by fragment are the same request either way), NOT the
 * further trailing-slash-stripped comparison key. That distinction matters:
 * `normalizeForDedup` is only a comparison key for "is this the same page
 * as one already found," never the URL that gets fetched — fetching the
 * key form instead of the real link would silently rewrite every
 * trailing-slash-authored link (the norm on many sites) into its
 * non-trailing-slash variant before the crawl ever starts, making the
 * crawler trigger a same-site redirect on nearly every page purely as a
 * side effect of its own dedup bookkeeping, not because the site itself
 * redirects that URL.
 */
function resolveInternalLinks(html: string, baseUrl: URL): string[] {
  const seenByDedupKey = new Map<string, string>();

  for (const href of extractLinkHrefs(html)) {
    let absolute: URL;
    try {
      absolute = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (absolute.protocol !== "http:" && absolute.protocol !== "https:") continue;
    if (absolute.hostname !== baseUrl.hostname) continue;
    if (looksLikeNonHtmlAsset(absolute.pathname)) continue;

    const dedupKey = normalizeForDedup(absolute);
    if (seenByDedupKey.has(dedupKey)) continue;

    const fetchableUrl = new URL(absolute.toString());
    fetchableUrl.hash = "";
    seenByDedupKey.set(dedupKey, fetchableUrl.toString());
  }

  return [...seenByDedupKey.values()];
}

/** Path-only blocking check against the crawl's single robots.txt fetch —
 * `null` group (any inconclusive fetch/parse outcome) always means "not
 * blocked," per robotsTxt.ts's contract. */
function isBlockedByRobots(url: string, robotsGroup: RobotsGroup | null): boolean {
  if (!robotsGroup) return false;
  return isPathBlocked(robotsGroup, new URL(url).pathname);
}

async function fetchAndAnalyze(url: string, robotsGroup: RobotsGroup | null): Promise<AnalyzedPage> {
  const fetched = await fetchPage(url);
  const html = fetched.error === null ? (fetched.html ?? "") : null;

  return analyzePage({
    url,
    fetched,
    title: html !== null ? extractTitle(html) : null,
    metaDescription: html !== null ? extractMetaContent(html, "description") : null,
    metaRobots: html !== null ? extractMetaContent(html, "robots") : null,
    rawCanonicalHref: html !== null ? extractCanonical(html) : null,
    h1: html !== null ? extractFirstH1(html) : null,
    h1Count: html !== null ? extractH1Count(html) : 0,
    internalLinkCount: html !== null ? resolveInternalLinks(html, new URL(url)).length : 0,
    images: html !== null ? extractImages(html) : [],
    jsonLdBlocks: html !== null ? extractJsonLdBlocks(html) : [],
    blockedByRobotsTxt: isBlockedByRobots(url, robotsGroup),
  });
}

export type CrawlResult =
  | {
      ok: true;
      pages: AnalyzedPage[];
      faviconUrl: string | null;
      /** Evidence from the crawl's single robots.txt fetch, persisted for
       * transparency (e.g. "couldn't reach robots.txt" vs. "none found").
       * Never used for anything beyond that — blocking itself was already
       * applied per-page above via `blockedByRobotsTxt`. */
      robotsTxtStatus: number | null;
      robotsTxtFetchError: string | null;
    }
  | { ok: false; error: string };

/**
 * Crawls `startUrl` plus up to MAX_ADDITIONAL_PAGES same-site internal links
 * found on that start page (single hop — no recursion). External domains
 * and non-HTML assets are never followed.
 */
export async function runCrawl(startUrl: string): Promise<CrawlResult> {
  let parsedStart: URL;
  try {
    parsedStart = new URL(startUrl);
  } catch {
    return { ok: false, error: `"${startUrl}" is not a valid URL.` };
  }
  if (parsedStart.protocol !== "http:" && parsedStart.protocol !== "https:") {
    return { ok: false, error: "Only http/https URLs can be crawled." };
  }

  // Fetched alongside the seed page (not sequentially after it) — the two
  // are independent I/O, and robots.txt is small/fast, so this adds no
  // meaningful time to the crawl's existing budget.
  const [startFetched, robotsEvidence] = await Promise.all([
    fetchPage(parsedStart.toString()),
    fetchRobotsTxt(parsedStart.toString()),
  ]);
  if (startFetched.error !== null) {
    return {
      ok: false,
      error: `Could not reach ${parsedStart.toString()} (${startFetched.error}).`,
    };
  }

  // The seed page is how MARKO discovers every other page in this crawl —
  // if it's a bot-protection challenge rather than real content, there's
  // nothing to analyze or discover pages from. Fail the run cleanly rather
  // than analyzing the challenge page as if it were the site (which would
  // produce a false "Page not reachable" SEO finding — see the
  // boyaca.gov.co diagnosis in PROJECT_STATUS.md).
  if (startFetched.botProtectionBlocked) {
    return { ok: false, error: formatBotProtectionErrorMessage(startFetched.status) };
  }

  const startHtml = startFetched.html ?? "";
  const internalLinks = resolveInternalLinks(startHtml, parsedStart);

  const startPage = analyzePage({
    url: parsedStart.toString(),
    fetched: startFetched,
    title: extractTitle(startHtml),
    metaDescription: extractMetaContent(startHtml, "description"),
    metaRobots: extractMetaContent(startHtml, "robots"),
    rawCanonicalHref: extractCanonical(startHtml),
    h1: extractFirstH1(startHtml),
    h1Count: extractH1Count(startHtml),
    internalLinkCount: internalLinks.length,
    images: extractImages(startHtml),
    jsonLdBlocks: extractJsonLdBlocks(startHtml),
    blockedByRobotsTxt: isBlockedByRobots(parsedStart.toString(), robotsEvidence.group),
  });

  const pages: AnalyzedPage[] = [startPage];

  // Compared against the *normalized* seed URL (not the raw one) so a
  // trailing-slash-variant link back to the start page (e.g. the seed is
  // registered as ".../blog" but a discovered link reads ".../blog/") is
  // still recognized as "the same page" and excluded — `startPage.url`
  // itself is left as the exact URL the site was registered with,
  // unchanged either way. `internalLinks` entries are literal (unnormalized
  // beyond fragment-stripping — see resolveInternalLinks), so each one is
  // normalized here, at comparison time, rather than comparing it directly
  // against the already-normalized `startNormalized`.
  const startNormalized = normalizeForDedup(parsedStart);
  const linksToFollow = internalLinks
    .filter((link) => normalizeForDedup(new URL(link)) !== startNormalized)
    .slice(0, MAX_ADDITIONAL_PAGES);

  // Fetched in small concurrent batches (see FETCH_CONCURRENCY) rather
  // than one at a time — `Promise.all` preserves each batch's input
  // order, so `pages` ends up in the exact same link-discovery order a
  // fully sequential crawl would have produced.
  for (let i = 0; i < linksToFollow.length; i += FETCH_CONCURRENCY) {
    const batch = linksToFollow.slice(i, i + FETCH_CONCURRENCY);
    const analyzed = await Promise.all(
      batch.map((link) => fetchAndAnalyze(link, robotsEvidence.group)),
    );
    pages.push(...analyzed);
  }

  const faviconUrl = resolveFaviconUrl(startHtml, parsedStart);

  return {
    ok: true,
    pages: applyCrossPageChecks(pages),
    faviconUrl,
    robotsTxtStatus: robotsEvidence.status,
    robotsTxtFetchError: robotsEvidence.fetchError,
  };
}
