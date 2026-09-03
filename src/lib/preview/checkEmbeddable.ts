import { assertSafeToFetch } from "@/lib/crawler/ssrfGuard";

const TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "MarkoBot/0.1 (+SEO audit of your own site; manual crawl)";

function isBlockingFrameOptions(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "deny" || normalized === "sameorigin";
}

function isBlockingFrameAncestors(csp: string | null): boolean {
  if (!csp) return false;
  const directive = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith("frame-ancestors"));
  if (!directive) return false;

  const sources = directive.split(/\s+/).slice(1);
  if (sources.length === 0) return false; // "frame-ancestors" with no sources is a no-op
  if (sources.includes("*")) return false;

  // Any other explicit source list (including 'none' or 'self') can't be
  // confirmed to include this app's own — possibly per-environment —
  // origin, so it's treated conservatively as blocking rather than risking
  // a live iframe that renders broken.
  return true;
}

/**
 * - "embeddable": no restrictive header found — an iframe attempt is safe to try.
 * - "blocked": the site's own X-Frame-Options or CSP `frame-ancestors` header
 *   was read and explicitly restricts framing — a *confirmed* restriction,
 *   not a guess.
 * - "unavailable": anything else (fetch error, timeout, SSRF-guard
 *   rejection, ambiguous redirect, etc.) — embedding wasn't ruled out by a
 *   real header, just not confirmed safe.
 *
 * The UI only shows the "this site doesn't allow embedded previews"
 * messaging for "blocked", never for "unavailable", since the latter is not
 * a confirmed framing restriction.
 */
export type EmbedCheckResult = "embeddable" | "blocked" | "unavailable";

/**
 * Best-effort, header-based check for whether a client's site can be
 * embedded in an iframe here: reads the target's own X-Frame-Options / CSP
 * `frame-ancestors` response headers and nothing else — it never attempts
 * to bypass, strip, or override an embedding restriction the site sets.
 *
 * Reuses the crawler's SSRF guard since, like the crawler, this fetches a
 * URL the client registered themselves. Fails closed: any fetch error,
 * timeout, or ambiguous header is treated as "unavailable" (not
 * "embeddable") so the UI never has to gamble on a live iframe attempt
 * coming back broken.
 */
export async function checkSiteEmbeddable(url: string): Promise<EmbedCheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    let currentUrl: URL;
    try {
      currentUrl = new URL(url);
    } catch {
      return "unavailable";
    }

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const safety = await assertSafeToFetch(currentUrl);
      if (!safety.ok) return "unavailable";

      let response: Response;
      try {
        response = await fetch(currentUrl.toString(), {
          method: "GET",
          signal: controller.signal,
          redirect: "manual",
          headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
        });
      } catch {
        return "unavailable";
      }

      // Headers only — the body is never needed, so it's cancelled instead
      // of read, avoiding downloading the page a second time.
      void response.body?.cancel();

      const isRedirect = response.status >= 300 && response.status < 400;
      if (isRedirect) {
        const location = response.headers.get("location");
        if (!location || hop === MAX_REDIRECTS) return "unavailable";
        try {
          currentUrl = new URL(location, currentUrl);
        } catch {
          return "unavailable";
        }
        continue;
      }

      if (isBlockingFrameOptions(response.headers.get("x-frame-options"))) return "blocked";
      if (isBlockingFrameAncestors(response.headers.get("content-security-policy"))) return "blocked";
      return "embeddable";
    }

    return "unavailable";
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timeout);
  }
}
