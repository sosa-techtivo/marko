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
};

function isHtmlContentType(contentType: string | null): boolean {
  if (!contentType) return false; // no header: never assume HTML
  const type = contentType.toLowerCase();
  return type.includes("text/html") || type.includes("application/xhtml+xml");
}

function errorResult(message: string): FetchedPage {
  return { status: null, html: null, contentType: null, xRobotsTag: null, error: message };
}

export async function fetchPage(url: string): Promise<FetchedPage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    let currentUrl: URL;
    try {
      currentUrl = new URL(url);
    } catch {
      return errorResult(`"${url}" is not a valid URL.`);
    }

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const safety = await assertSafeToFetch(currentUrl);
      if (!safety.ok) {
        return errorResult(safety.reason);
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
          return errorResult(`Received a ${response.status} redirect with no Location header.`);
        }
        let nextUrl: URL;
        try {
          nextUrl = new URL(location, currentUrl);
        } catch {
          return errorResult(`Redirect target "${location}" is not a valid URL.`);
        }
        if (hop === MAX_REDIRECTS) {
          return errorResult(`Too many redirects (limit ${MAX_REDIRECTS}).`);
        }
        currentUrl = nextUrl;
        continue;
      }

      const contentType = response.headers.get("content-type");
      const xRobotsTag = response.headers.get("x-robots-tag");

      if (!isHtmlContentType(contentType)) {
        return { status: response.status, html: null, contentType, xRobotsTag, error: null };
      }

      const buffer = await response.arrayBuffer();
      const truncated = buffer.byteLength > MAX_BODY_BYTES ? buffer.slice(0, MAX_BODY_BYTES) : buffer;
      const html = new TextDecoder("utf-8", { fatal: false }).decode(truncated);

      return { status: response.status, html, contentType, xRobotsTag, error: null };
    }

    return errorResult(`Too many redirects (limit ${MAX_REDIRECTS}).`);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? `Timed out after ${FETCH_TIMEOUT_MS / 1000}s`
          : err.message
        : "Unknown fetch error";
    return errorResult(message);
  } finally {
    clearTimeout(timeout);
  }
}
