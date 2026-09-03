import { describe, expect, it } from "vitest";
import { analyzePage, type CrawlIssueType } from "./analyze";
import type { FetchedPage } from "./fetchPage";
import { META_DESCRIPTION_MIN_LENGTH, TITLE_MIN_LENGTH } from "./seoRules";

const VALID_TITLE = "A Title That Comfortably Meets The Minimum Length";
const VALID_META_DESCRIPTION =
  "A meta description that is written to comfortably exceed the fifty character minimum threshold.";

function fetched(overrides: Partial<FetchedPage> = {}): FetchedPage {
  return {
    status: 200,
    html: "<html></html>",
    contentType: "text/html",
    xRobotsTag: null,
    error: null,
    botProtectionBlocked: false,
    ...overrides,
  };
}

function baseParams(overrides: Partial<Parameters<typeof analyzePage>[0]> = {}) {
  return {
    url: "https://example.com/",
    fetched: fetched(),
    title: VALID_TITLE,
    metaDescription: VALID_META_DESCRIPTION,
    metaRobots: null,
    rawCanonicalHref: "https://example.com/",
    h1: "Welcome",
    h1Count: 1,
    internalLinkCount: 3,
    ...overrides,
  };
}

function issueTypes(page: ReturnType<typeof analyzePage>): CrawlIssueType[] {
  return page.issues.map((issue) => issue.type);
}

describe("analyzePage — a fully healthy page", () => {
  it("raises no issues", () => {
    const page = analyzePage(baseParams());
    expect(page.issues).toEqual([]);
  });
});

describe("analyzePage — HTTP status", () => {
  it("flags a non-2xx response as http_error", () => {
    const page = analyzePage(baseParams({ fetched: fetched({ status: 404 }) }));
    expect(issueTypes(page)).toContain("http_error");
  });

  it("flags a fetch failure as http_error", () => {
    const page = analyzePage(
      baseParams({ fetched: fetched({ status: null, html: null, error: "timed out" }) }),
    );
    expect(issueTypes(page)).toContain("http_error");
  });

  it("does not flag http_error for a confirmed bot-protection block", () => {
    const page = analyzePage(
      baseParams({
        fetched: fetched({ status: 403, html: null, error: null, botProtectionBlocked: true }),
      }),
    );
    expect(issueTypes(page)).not.toContain("http_error");
  });

  it("skips all other page-level checks once the page failed to fetch", () => {
    const page = analyzePage(
      baseParams({
        fetched: fetched({ status: 500 }),
        title: null,
        metaDescription: null,
        h1: null,
        h1Count: 0,
        rawCanonicalHref: null,
      }),
    );
    // Only http_error — a page that isn't reachable shouldn't also be
    // reported as "missing title", "missing H1", etc.
    expect(issueTypes(page)).toEqual(["http_error"]);
  });
});

describe("analyzePage — title", () => {
  it("flags a missing title", () => {
    const page = analyzePage(baseParams({ title: null }));
    expect(issueTypes(page)).toContain("missing_title");
  });

  it("flags a title shorter than the minimum", () => {
    const page = analyzePage(baseParams({ title: "Too short" }));
    expect(issueTypes(page)).toContain("title_too_short");
  });

  it("flags a title longer than the maximum", () => {
    const page = analyzePage(baseParams({ title: "A".repeat(120) }));
    expect(issueTypes(page)).toContain("title_too_long");
  });

  it("does not flag a title exactly at the minimum length", () => {
    const page = analyzePage(baseParams({ title: "A".repeat(TITLE_MIN_LENGTH) }));
    expect(issueTypes(page)).not.toContain("title_too_short");
  });
});

describe("analyzePage — meta description", () => {
  it("flags a missing meta description", () => {
    const page = analyzePage(baseParams({ metaDescription: null }));
    expect(issueTypes(page)).toContain("missing_meta_description");
  });

  it("flags a meta description shorter than the minimum", () => {
    const page = analyzePage(baseParams({ metaDescription: "Too short" }));
    expect(issueTypes(page)).toContain("meta_description_too_short");
  });

  it("flags a meta description longer than the maximum", () => {
    const page = analyzePage(baseParams({ metaDescription: "A".repeat(200) }));
    expect(issueTypes(page)).toContain("meta_description_too_long");
  });

  it("does not flag a meta description exactly at the minimum length", () => {
    const page = analyzePage(
      baseParams({ metaDescription: "A".repeat(META_DESCRIPTION_MIN_LENGTH) }),
    );
    expect(issueTypes(page)).not.toContain("meta_description_too_short");
  });
});

describe("analyzePage — headings", () => {
  it("flags a missing H1", () => {
    const page = analyzePage(baseParams({ h1: null, h1Count: 0 }));
    expect(issueTypes(page)).toContain("missing_h1");
  });

  it("flags multiple H1s", () => {
    const page = analyzePage(baseParams({ h1Count: 2 }));
    expect(issueTypes(page)).toContain("multiple_h1");
  });

  it("does not flag exactly one H1", () => {
    const page = analyzePage(baseParams({ h1Count: 1 }));
    expect(issueTypes(page)).not.toContain("multiple_h1");
  });
});

describe("analyzePage — indexability", () => {
  it("flags a page marked noindex via meta robots", () => {
    const page = analyzePage(baseParams({ metaRobots: "noindex" }));
    expect(issueTypes(page)).toContain("non_indexable");
    expect(page.isIndexable).toBe(false);
  });

  it("flags a page marked noindex via the X-Robots-Tag header", () => {
    const page = analyzePage(
      baseParams({ fetched: fetched({ xRobotsTag: "noindex" }) }),
    );
    expect(issueTypes(page)).toContain("non_indexable");
  });

  it("treats an indexable page as indexable", () => {
    const page = analyzePage(baseParams());
    expect(page.isIndexable).toBe(true);
  });
});

describe("analyzePage — canonical", () => {
  it("flags a missing canonical tag", () => {
    const page = analyzePage(baseParams({ rawCanonicalHref: null }));
    expect(issueTypes(page)).toContain("missing_canonical");
  });

  it("flags an empty canonical href", () => {
    const page = analyzePage(baseParams({ rawCanonicalHref: "   " }));
    expect(issueTypes(page)).toContain("invalid_canonical");
  });

  it("flags an unparsable canonical href", () => {
    const page = analyzePage(baseParams({ rawCanonicalHref: "http://[" }));
    expect(issueTypes(page)).toContain("invalid_canonical");
  });

  it("flags a canonical pointing to a different domain", () => {
    const page = analyzePage(
      baseParams({ rawCanonicalHref: "https://other-domain.com/page" }),
    );
    expect(issueTypes(page)).toContain("invalid_canonical");
  });

  it("does not flag a same-host canonical pointing to a different path", () => {
    // Same-host but different URL is common, legitimate canonical usage
    // (pagination, tracking-param stripping, etc.) — analyzePage itself
    // must not treat "differs from self" alone as an error; only
    // crossPageChecks' more specific signals (duplicate consolidation,
    // canonical chains) should ever flag this scenario.
    const page = analyzePage(
      baseParams({ rawCanonicalHref: "https://example.com/canonical-target" }),
    );
    expect(issueTypes(page)).not.toContain("invalid_canonical");
    expect(page.canonicalUrl).toBe("https://example.com/canonical-target");
  });

  it("resolves a relative canonical href against the page URL", () => {
    const page = analyzePage(
      baseParams({ url: "https://example.com/blog/post", rawCanonicalHref: "/blog/post" }),
    );
    expect(page.canonicalUrl).toBe("https://example.com/blog/post");
    expect(issueTypes(page)).not.toContain("invalid_canonical");
  });
});
