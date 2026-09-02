import { fetchPage } from "./fetchPage";
import {
  extractCanonical,
  extractFirstH1,
  extractH1Count,
  extractLinkHrefs,
  extractMetaContent,
  extractTitle,
} from "./html";
import { analyzePage, type AnalyzedPage } from "./analyze";
import { applyCrossPageChecks } from "./crossPageChecks";
import { resolveFaviconUrl } from "./favicon";
import { formatBotProtectionErrorMessage } from "./botProtection";

/**
 * MVP crawl limit: the start URL plus up to this many same-site internal
 * links found on the start page itself. Deliberately 1-level breadth-first
 * (links found on the *additional* pages are not followed) — this keeps a
 * manual, synchronous, in-request crawl small, fast, and predictable.
 */
export const MAX_ADDITIONAL_PAGES = 4;
export const MAX_PAGES_PER_CRAWL = 1 + MAX_ADDITIONAL_PAGES;

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

/** Same-host, http(s), non-asset links found in `html`, deduped, fragment-stripped. */
function resolveInternalLinks(html: string, baseUrl: URL): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

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

    absolute.hash = "";
    const normalized = absolute.toString();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    results.push(normalized);
  }

  return results;
}

async function fetchAndAnalyze(url: string): Promise<AnalyzedPage> {
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
  });
}

export type CrawlResult =
  | { ok: true; pages: AnalyzedPage[]; faviconUrl: string | null }
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

  const startFetched = await fetchPage(parsedStart.toString());
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
  });

  const pages: AnalyzedPage[] = [startPage];

  const linksToFollow = internalLinks
    .filter((link) => link !== parsedStart.toString())
    .slice(0, MAX_ADDITIONAL_PAGES);

  for (const link of linksToFollow) {
    pages.push(await fetchAndAnalyze(link));
  }

  const faviconUrl = resolveFaviconUrl(startHtml, parsedStart);

  return { ok: true, pages: applyCrossPageChecks(pages), faviconUrl };
}
