import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchedPage } from "./fetchPage";
import type { RobotsTxtEvidence } from "./robotsTxt";

// `fetchPage` does the actual network I/O — mocked so these tests exercise
// only runCrawl's own discovery/dedup/cap/concurrency logic, never a real
// request. Each test controls what URL maps to what response.
vi.mock("./fetchPage", () => ({ fetchPage: vi.fn() }));

// Only the I/O (fetchRobotsTxt) is mocked — parseRobotsTxt/selectApplicable
// Group/isPathBlocked stay real, so tests that do provide a group still
// exercise runCrawl's actual blocking wire-up end to end.
vi.mock("./robotsTxt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./robotsTxt")>();
  return { ...actual, fetchRobotsTxt: vi.fn() };
});

const { fetchPage } = await import("./fetchPage");
const { fetchRobotsTxt } = await import("./robotsTxt");
const { runCrawl, MAX_ADDITIONAL_PAGES, MAX_PAGES_PER_CRAWL } = await import("./runCrawl");

const mockedFetchPage = vi.mocked(fetchPage);
const mockedFetchRobotsTxt = vi.mocked(fetchRobotsTxt);

// Every test gets a permissive default (no robots.txt found) unless it
// explicitly overrides this, so the many pre-existing tests below don't
// need to know robots.txt exists at all.
const NO_ROBOTS_TXT: RobotsTxtEvidence = { status: 404, fetchError: null, group: null };

function htmlPage(hrefs: string[]): string {
  const links = hrefs.map((href) => `<a href="${href}">link</a>`).join("\n");
  return `<html><head><title>Page</title></head><body>${links}</body></html>`;
}

function ok(html: string, overrides: Partial<FetchedPage> = {}): FetchedPage {
  return {
    status: 200,
    html,
    contentType: "text/html",
    xRobotsTag: null,
    error: null,
    botProtectionBlocked: false,
    finalUrl: null,
    redirectCount: 0,
    ...overrides,
  };
}

/** Registers canned responses for a fixed set of URLs; any URL fetched
 * outside that set fails the test loudly instead of silently returning
 * something unexpected. */
function mockSite(pages: Record<string, FetchedPage>) {
  mockedFetchPage.mockImplementation(async (url: string) => {
    const response = pages[url];
    if (!response) {
      throw new Error(`unexpected fetchPage call for unmocked URL: ${url}`);
    }
    return response;
  });
}

beforeEach(() => {
  mockedFetchRobotsTxt.mockResolvedValue(NO_ROBOTS_TXT);
});

afterEach(() => {
  mockedFetchPage.mockReset();
  mockedFetchRobotsTxt.mockReset();
});

describe("runCrawl — page cap", () => {
  it("stops at MAX_PAGES_PER_CRAWL total pages even when far more are discovered", async () => {
    const allLinks = Array.from({ length: 30 }, (_, i) => `https://example.com/page-${i}`);
    const pages: Record<string, FetchedPage> = {
      "https://example.com/": ok(htmlPage(allLinks)),
    };
    for (const link of allLinks) {
      pages[link] = ok(htmlPage([]));
    }
    mockSite(pages);

    const result = await runCrawl("https://example.com/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.pages).toHaveLength(MAX_PAGES_PER_CRAWL);
    // The additional pages actually followed are the first
    // MAX_ADDITIONAL_PAGES in discovery order, not an arbitrary subset.
    expect(result.pages.slice(1).map((p) => p.url)).toEqual(allLinks.slice(0, MAX_ADDITIONAL_PAGES));
  });

  it("returns fewer pages when fewer are discovered — a small site isn't padded out", async () => {
    mockSite({
      "https://example.com/": ok(
        htmlPage(["https://example.com/about", "https://example.com/contact"]),
      ),
      "https://example.com/about": ok(htmlPage([])),
      "https://example.com/contact": ok(htmlPage([])),
    });

    const result = await runCrawl("https://example.com/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toHaveLength(3);
  });
});

describe("runCrawl — same-site only", () => {
  it("never follows external-domain links", async () => {
    mockSite({
      "https://example.com/": ok(
        htmlPage(["https://example.com/internal", "https://other-domain.com/external"]),
      ),
      "https://example.com/internal": ok(htmlPage([])),
    });

    const result = await runCrawl("https://example.com/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.pages.map((p) => p.url)).toEqual([
      "https://example.com/",
      "https://example.com/internal",
    ]);
    expect(mockedFetchPage).not.toHaveBeenCalledWith(
      expect.stringContaining("other-domain.com"),
    );
  });
});

describe("runCrawl — URL de-duplication", () => {
  it("does not crawl an exact-duplicate discovered URL twice", async () => {
    mockSite({
      "https://example.com/": ok(
        htmlPage(["https://example.com/dup", "https://example.com/dup"]),
      ),
      "https://example.com/dup": ok(htmlPage([])),
    });

    const result = await runCrawl("https://example.com/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toHaveLength(2);
    expect(mockedFetchPage).toHaveBeenCalledTimes(2); // seed + the one distinct page
  });

  it("treats fragment-only variants of the same URL as one page", async () => {
    mockSite({
      "https://example.com/": ok(
        htmlPage([
          "https://example.com/page#section-a",
          "https://example.com/page#section-b",
          "https://example.com/page",
        ]),
      ),
      "https://example.com/page": ok(htmlPage([])),
    });

    const result = await runCrawl("https://example.com/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages.map((p) => p.url)).toEqual([
      "https://example.com/",
      "https://example.com/page",
    ]);
  });

  it("treats a trailing-slash variant of the same non-root URL as one page", async () => {
    mockSite({
      "https://example.com/": ok(
        htmlPage(["https://example.com/about", "https://example.com/about/"]),
      ),
      "https://example.com/about": ok(htmlPage([])),
    });

    const result = await runCrawl("https://example.com/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages.map((p) => p.url)).toEqual([
      "https://example.com/",
      "https://example.com/about",
    ]);
  });

  it("does not merge two URLs that differ only by query string", async () => {
    // Query strings can represent genuinely different pages — must never
    // be silently normalized away, unlike fragments/trailing slashes.
    mockSite({
      "https://example.com/": ok(
        htmlPage(["https://example.com/list?page=1", "https://example.com/list?page=2"]),
      ),
      "https://example.com/list?page=1": ok(htmlPage([])),
      "https://example.com/list?page=2": ok(htmlPage([])),
    });

    const result = await runCrawl("https://example.com/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toHaveLength(3);
  });

  it("excludes a link back to the seed page even as a trailing-slash variant", async () => {
    mockSite({
      "https://example.com/blog": ok(
        htmlPage(["https://example.com/blog/", "https://example.com/blog/post-1"]),
      ),
      "https://example.com/blog/post-1": ok(htmlPage([])),
    });

    const result = await runCrawl("https://example.com/blog");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only the seed itself (unchanged URL) and the one genuinely-new page —
    // the self-referencing trailing-slash link is not re-crawled as if it
    // were a distinct additional page.
    expect(result.pages.map((p) => p.url)).toEqual([
      "https://example.com/blog",
      "https://example.com/blog/post-1",
    ]);
  });
});

describe("runCrawl — link normalization does not itself cause redirects", () => {
  it("fetches a trailing-slash-authored link exactly as written, not a self-inflicted stripped variant", async () => {
    // Regression: resolveInternalLinks used to fetch the *dedup-normalized*
    // (trailing-slash-stripped) form of every discovered link instead of
    // the literal href, so a site whose own pages consistently use a
    // trailing slash would appear to "redirect" on nearly every page —
    // not because the site redirects anything, but because MARKO stripped
    // the slash itself before fetching.
    mockSite({
      "https://example.com/": ok(htmlPage(["https://example.com/about/"])),
      "https://example.com/about/": ok(htmlPage([])),
    });

    const result = await runCrawl("https://example.com/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(mockedFetchPage).toHaveBeenCalledWith("https://example.com/about/");
    const page = result.pages.find((p) => p.url === "https://example.com/about/");
    expect(page).toBeDefined();
  });

  it("still fetches (and can flag as redirected) a link authored without a trailing slash", async () => {
    // The other half of the same fix: a genuinely non-canonical link form
    // must still be fetched literally, so a real server-side redirect is
    // still observed and reported — only MARKO's own normalization was the
    // bug, not trailing-slash redirects in general.
    mockSite({
      "https://example.com/": ok(htmlPage(["https://example.com/about"])),
      "https://example.com/about": ok(htmlPage([]), {
        finalUrl: "https://example.com/about/",
        redirectCount: 1,
      }),
    });

    const result = await runCrawl("https://example.com/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(mockedFetchPage).toHaveBeenCalledWith("https://example.com/about");
    const page = result.pages.find((p) => p.url === "https://example.com/about");
    expect(page?.redirectCount).toBe(1);
    expect(page?.issues.some((i) => i.type === "redirected")).toBe(true);
  });

  it("still deduplicates a trailing-slash variant against its non-slash sibling, keeping the first-seen literal form", async () => {
    mockSite({
      "https://example.com/": ok(
        htmlPage(["https://example.com/about", "https://example.com/about/"]),
      ),
      "https://example.com/about": ok(htmlPage([])),
    });

    const result = await runCrawl("https://example.com/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages.map((p) => p.url)).toEqual([
      "https://example.com/",
      "https://example.com/about",
    ]);
  });
});

describe("runCrawl — non-HTML asset filtering", () => {
  it("skips obvious download/asset URLs entirely", async () => {
    mockSite({
      "https://example.com/": ok(
        htmlPage([
          "https://example.com/brochure.pdf",
          "https://example.com/photo.jpg",
          "https://example.com/app.js",
          "https://example.com/real-page",
        ]),
      ),
      "https://example.com/real-page": ok(htmlPage([])),
    });

    const result = await runCrawl("https://example.com/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages.map((p) => p.url)).toEqual([
      "https://example.com/",
      "https://example.com/real-page",
    ]);
    expect(mockedFetchPage).toHaveBeenCalledTimes(2);
  });
});

describe("runCrawl — blocked/failed pages", () => {
  it("fails the whole run when the seed page itself is bot-protection-blocked", async () => {
    mockSite({
      "https://example.com/": ok("", { status: 403, botProtectionBlocked: true }),
    });

    const result = await runCrawl("https://example.com/");
    expect(result.ok).toBe(false);
    // No additional pages are ever attempted once the seed is blocked.
    expect(mockedFetchPage).toHaveBeenCalledTimes(1);
  });

  it("continues the crawl when only an additional page is unreachable", async () => {
    mockSite({
      "https://example.com/": ok(
        htmlPage(["https://example.com/broken", "https://example.com/fine"]),
      ),
      "https://example.com/broken": {
        status: null,
        html: null,
        contentType: null,
        xRobotsTag: null,
        error: "Timed out after 8s",
        botProtectionBlocked: false,
        finalUrl: "https://example.com/broken",
        redirectCount: 0,
      },
      "https://example.com/fine": ok(htmlPage([])),
    });

    const result = await runCrawl("https://example.com/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.pages).toHaveLength(3);
    const broken = result.pages.find((p) => p.url === "https://example.com/broken");
    expect(broken?.fetchError).toBe("Timed out after 8s");
    expect(broken?.issues.some((i) => i.type === "http_error")).toBe(true);
    // The sibling page in the same concurrent batch is unaffected.
    const fine = result.pages.find((p) => p.url === "https://example.com/fine");
    expect(fine?.issues.some((i) => i.type === "http_error")).toBe(false);
  });

  it("continues the crawl when an additional page is itself bot-protection-blocked", async () => {
    mockSite({
      "https://example.com/": ok(
        htmlPage(["https://example.com/protected", "https://example.com/fine"]),
      ),
      "https://example.com/protected": ok("", { status: 403, botProtectionBlocked: true }),
      "https://example.com/fine": ok(htmlPage([])),
    });

    const result = await runCrawl("https://example.com/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.pages).toHaveLength(3);
    const protectedPage = result.pages.find((p) => p.url === "https://example.com/protected");
    // A bot-protection block on an *additional* page is not reported as a
    // "page not reachable" SEO finding — MARKO only knows its own crawler
    // was denied, not that the page is actually broken.
    expect(protectedPage?.issues.some((i) => i.type === "http_error")).toBe(false);
  });
});

describe("runCrawl — robots.txt blocking", () => {
  it("flags a page disallowed by robots.txt while leaving other pages unaffected", async () => {
    mockedFetchRobotsTxt.mockResolvedValue({
      status: 200,
      fetchError: null,
      group: { userAgents: ["*"], directives: [{ type: "disallow", path: "/private" }] },
    });
    mockSite({
      "https://example.com/": ok(
        htmlPage(["https://example.com/private", "https://example.com/public"]),
      ),
      "https://example.com/private": ok(htmlPage([])),
      "https://example.com/public": ok(htmlPage([])),
    });

    const result = await runCrawl("https://example.com/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const blocked = result.pages.find((p) => p.url === "https://example.com/private");
    const notBlocked = result.pages.find((p) => p.url === "https://example.com/public");
    expect(blocked?.issues.some((i) => i.type === "blocked_by_robots_txt")).toBe(true);
    expect(notBlocked?.issues.some((i) => i.type === "blocked_by_robots_txt")).toBe(false);
    expect(result.robotsTxtStatus).toBe(200);
    expect(result.robotsTxtFetchError).toBeNull();
  });

  it("never blocks anything when the robots.txt fetch was inconclusive", async () => {
    mockedFetchRobotsTxt.mockResolvedValue({
      status: 500,
      fetchError: "robots.txt returned status 500.",
      group: null,
    });
    mockSite({
      "https://example.com/": ok(htmlPage([])),
    });

    const result = await runCrawl("https://example.com/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.pages[0].issues.some((i) => i.type === "blocked_by_robots_txt")).toBe(false);
    expect(result.robotsTxtStatus).toBe(500);
    expect(result.robotsTxtFetchError).toBe("robots.txt returned status 500.");
  });
});

describe("runCrawl — redirect transparency", () => {
  it("carries finalUrl/redirectCount through and raises a redirected finding, without an http_error", async () => {
    mockSite({
      "https://example.com/": ok(htmlPage(["https://example.com/old-page"])),
      "https://example.com/old-page": ok(htmlPage([]), {
        finalUrl: "https://example.com/new-page",
        redirectCount: 1,
      }),
    });

    const result = await runCrawl("https://example.com/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const redirected = result.pages.find((p) => p.url === "https://example.com/old-page");
    expect(redirected?.finalUrl).toBe("https://example.com/new-page");
    expect(redirected?.redirectCount).toBe(1);
    expect(redirected?.issues.some((i) => i.type === "redirected")).toBe(true);
    expect(redirected?.issues.some((i) => i.type === "http_error")).toBe(false);
  });

  it("excludes a redirecting page from cross-page duplicate-title detection against its own destination", async () => {
    mockSite({
      "https://example.com/": ok(
        htmlPage(["https://example.com/old-page", "https://example.com/new-page"]),
      ),
      "https://example.com/old-page": ok(
        `<html><head><title>Same Title</title></head><body></body></html>`,
        { finalUrl: "https://example.com/new-page", redirectCount: 1 },
      ),
      "https://example.com/new-page": ok(
        `<html><head><title>Same Title</title></head><body></body></html>`,
      ),
    });

    const result = await runCrawl("https://example.com/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Only one page actually carries "Same Title" as real content (the
    // redirect source doesn't count), so this is not a duplicate at all.
    expect(result.pages.every((p) => !p.issues.some((i) => i.type === "duplicate_title"))).toBe(
      true,
    );
  });
});

describe("runCrawl — redirected seed link resolution", () => {
  it("resolves a relative link on a redirected seed page against the final URL, not the registered one", async () => {
    // Exact regression scenario: registered https://techtivo.com redirects
    // to https://www.techtivo.com/; a relative link on that (real, final)
    // page must resolve against www.techtivo.com, not bounce back to the
    // bare apex domain the site was originally requested at.
    mockSite({
      "https://techtivo.com/": ok(htmlPage(["/about-us/"]), {
        finalUrl: "https://www.techtivo.com/",
        redirectCount: 1,
      }),
      "https://www.techtivo.com/about-us/": ok(htmlPage([])),
    });

    const result = await runCrawl("https://techtivo.com/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(mockedFetchPage).toHaveBeenCalledWith("https://www.techtivo.com/about-us/");
    expect(mockedFetchPage).not.toHaveBeenCalledWith("https://techtivo.com/about-us/");
    expect(result.pages.map((p) => p.url)).toEqual([
      "https://techtivo.com/",
      "https://www.techtivo.com/about-us/",
    ]);
  });

  it("treats an absolute link to the redirected seed's true host as same-site (not external)", async () => {
    // Under the pre-fix same-site check (compared against the originally
    // requested host), an absolute link to the page's own true host would
    // have been wrongly excluded as "external" once the seed redirected to
    // a different host.
    mockSite({
      "https://techtivo.com/": ok(htmlPage(["https://www.techtivo.com/contact/"]), {
        finalUrl: "https://www.techtivo.com/",
        redirectCount: 1,
      }),
      "https://www.techtivo.com/contact/": ok(htmlPage([])),
    });

    const result = await runCrawl("https://techtivo.com/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.pages.map((p) => p.url)).toContain("https://www.techtivo.com/contact/");
  });

  it("excludes a self-link on a redirected seed page (e.g. a home link) instead of re-crawling it as a new page", async () => {
    mockSite({
      "https://techtivo.com/": ok(htmlPage(["/", "/about-us/"]), {
        finalUrl: "https://www.techtivo.com/",
        redirectCount: 1,
      }),
      "https://www.techtivo.com/about-us/": ok(htmlPage([])),
    });

    const result = await runCrawl("https://techtivo.com/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Only the seed itself and the one genuinely new page — the self-link
    // (resolving to the seed's own final URL) is not queued as an
    // additional page, so the homepage is never fetched/analyzed twice.
    expect(result.pages.map((p) => p.url)).toEqual([
      "https://techtivo.com/",
      "https://www.techtivo.com/about-us/",
    ]);
  });

  it("counts internalLinkCount using the same effective (final) base URL, on both the seed and an additional page", async () => {
    mockSite({
      "https://techtivo.com/": ok(
        htmlPage(["/about-us/", "https://www.techtivo.com/contact/"]),
        { finalUrl: "https://www.techtivo.com/", redirectCount: 1 },
      ),
      "https://www.techtivo.com/about-us/": ok(htmlPage([]), {
        finalUrl: "https://www.techtivo.com/about-us/",
        redirectCount: 0,
      }),
      "https://www.techtivo.com/contact/": ok(htmlPage([])),
    });

    const result = await runCrawl("https://techtivo.com/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const seed = result.pages.find((p) => p.url === "https://techtivo.com/");
    // Both discovered links resolve/count against the true (www) host —
    // neither is silently dropped as "external" or miscounted.
    expect(seed?.internalLinkCount).toBe(2);
  });

  it("leaves non-redirected seed behavior unchanged (relative links resolve against the requested URL as before)", async () => {
    mockSite({
      "https://example.com/": ok(htmlPage(["/about", "/contact"])),
      "https://example.com/about": ok(htmlPage([])),
      "https://example.com/contact": ok(htmlPage([])),
    });

    const result = await runCrawl("https://example.com/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.pages.map((p) => p.url)).toEqual([
      "https://example.com/",
      "https://example.com/about",
      "https://example.com/contact",
    ]);
    const seed = result.pages.find((p) => p.url === "https://example.com/");
    expect(seed?.internalLinkCount).toBe(2);
  });

  it("still reports finalUrl/redirectCount/the redirected finding correctly for the redirected seed itself", async () => {
    mockSite({
      "https://techtivo.com/": ok(htmlPage(["/about-us/"]), {
        finalUrl: "https://www.techtivo.com/",
        redirectCount: 1,
      }),
      "https://www.techtivo.com/about-us/": ok(htmlPage([])),
    });

    const result = await runCrawl("https://techtivo.com/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const seed = result.pages.find((p) => p.url === "https://techtivo.com/");
    expect(seed?.finalUrl).toBe("https://www.techtivo.com/");
    expect(seed?.redirectCount).toBe(1);
    expect(seed?.issues.some((i) => i.type === "redirected")).toBe(true);
    expect(seed?.issues.some((i) => i.type === "http_error")).toBe(false);
  });
});
