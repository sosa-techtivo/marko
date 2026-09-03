import { afterEach, describe, expect, it, vi } from "vitest";
import type { FetchedPage } from "./fetchPage";

// `fetchPage` does the actual network I/O — mocked so these tests exercise
// only runCrawl's own discovery/dedup/cap/concurrency logic, never a real
// request. Each test controls what URL maps to what response.
vi.mock("./fetchPage", () => ({ fetchPage: vi.fn() }));

const { fetchPage } = await import("./fetchPage");
const { runCrawl, MAX_ADDITIONAL_PAGES, MAX_PAGES_PER_CRAWL } = await import("./runCrawl");

const mockedFetchPage = vi.mocked(fetchPage);

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

afterEach(() => {
  mockedFetchPage.mockReset();
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
