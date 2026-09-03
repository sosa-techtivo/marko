import { assertSafeToFetch } from "./ssrfGuard";

const FETCH_TIMEOUT_MS = 8_000; // covers the whole redirect chain, not per-hop
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 2_000_000; // safety cap so a pathological response can't blow up parsing/memory
const USER_AGENT = "MarkoBot/0.1 (+SEO audit of your own site; manual crawl)";

export type FetchedPage = {
  status: number | null;
  html: string | null;
  contentType: string | null;
  xRobotsTag: string | null;
  error: string | null;
  /**
   * True when the response looks like a bot-protection challenge rather
   * than the site's real content (confirmed signal: a non-2xx response
   * carrying `cf-mitigated: challenge`, i.e. Cloudflare's own explicit
   * marker that it intercepted the request with a Managed Challenge —
   * see the boyaca.gov.co diagnosis in PROJECT_STATUS.md). Deliberately
   * narrow: this is not a general WAF-detection framework, just the one
   * confirmed, unambiguous signal. Never set by attempting to solve the
   * challenge, spoof a browser, or otherwise bypass it.
   */
  botProtectionBlocked: boolean;
  /**
   * The last URL actually fetched (after following any redirects). Null
   * only when the input `url` itself couldn't be parsed, i.e. no request
   * was ever made. Callers use this for redirect transparency — comparing
   * it against the original crawled URL — not for content extraction.
   */
  finalUrl: string | null;
  /** Number of redirect hops followed before landing on `finalUrl` (0 if none). */
  redirectCount: number;
};

function isHtmlContentType(contentType: string | null): boolean {
  if (!contentType) return false; // no header: never assume HTML
  const type = contentType.toLowerCase();
  return type.includes("text/html") || type.includes("application/xhtml+xml");
}

/** Confirmed signal only: a non-2xx response Cloudflare itself marks as a challenge. */
function isBotProtectionChallenge(status: number, headers: Headers): boolean {
  if (status >= 200 && status < 300) return false;
  const mitigated = headers.get("cf-mitigated");
  return mitigated !== null && mitigated.toLowerCase() === "challenge";
}

function errorResult(message: string, finalUrl: string | null, redirectCount: number): FetchedPage {
  return {
    status: null,
    html: null,
    contentType: null,
    xRobotsTag: null,
    error: message,
    botProtectionBlocked: false,
    finalUrl,
    redirectCount,
  };
}

export async function fetchPage(url: string): Promise<FetchedPage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  // Hoisted above the try so the catch block (network/timeout failures) can
  // still report how far the redirect chain got before it failed.
  let currentUrl: URL | null = null;
  let hopsFollowed = 0;

  try {
    try {
      currentUrl = new URL(url);
    } catch {
      return errorResult(`"${url}" is not a valid URL.`, null, 0);
    }

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      hopsFollowed = hop;
      const safety = await assertSafeToFetch(currentUrl);
      if (!safety.ok) {
        return errorResult(safety.reason, currentUrl.toString(), hop);
      }

      const response = await fetch(currentUrl.toString(), {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
        },
      });

      const isRedirect = response.status >= 300 && response.status < 400;
      if (isRedirect) {
        const location = response.headers.get("location");
        if (!location) {
          return errorResult(
            `Received a ${response.status} redirect with no Location header.`,
            currentUrl.toString(),
            hop,
          );
        }
        let nextUrl: URL;
        try {
          nextUrl = new URL(location, currentUrl);
        } catch {
          return errorResult(`Redirect target "${location}" is not a valid URL.`, currentUrl.toString(), hop);
        }
        if (hop === MAX_REDIRECTS) {
          return errorResult(`Too many redirects (limit ${MAX_REDIRECTS}).`, currentUrl.toString(), hop);
        }
        currentUrl = nextUrl;
        continue;
      }

      const contentType = response.headers.get("content-type");
      const xRobotsTag = response.headers.get("x-robots-tag");
      const botProtectionBlocked = isBotProtectionChallenge(response.status, response.headers);

      if (!isHtmlContentType(contentType)) {
        return {
          status: response.status,
          html: null,
          contentType,
          xRobotsTag,
          error: null,
          botProtectionBlocked,
          finalUrl: currentUrl.toString(),
          redirectCount: hop,
        };
      }

      const buffer = await response.arrayBuffer();
      const truncated = buffer.byteLength > MAX_BODY_BYTES ? buffer.slice(0, MAX_BODY_BYTES) : buffer;
      const html = new TextDecoder("utf-8", { fatal: false }).decode(truncated);

      return {
        status: response.status,
        html,
        contentType,
        xRobotsTag,
        error: null,
        botProtectionBlocked,
        finalUrl: currentUrl.toString(),
        redirectCount: hop,
      };
    }

    return errorResult(`Too many redirects (limit ${MAX_REDIRECTS}).`, currentUrl.toString(), MAX_REDIRECTS);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? `Timed out after ${FETCH_TIMEOUT_MS / 1000}s`
          : err.message
        : "Unknown fetch error";
    return errorResult(message, currentUrl ? currentUrl.toString() : null, hopsFollowed);
  } finally {
    clearTimeout(timeout);
  }
}
