import { describe, expect, it } from "vitest";
import { analyzePage, type CrawlIssueType } from "./analyze";
import type { FetchedPage } from "./fetchPage";
import type { ExtractedImage } from "./html";
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
    finalUrl: "https://example.com/",
    redirectCount: 0,
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
    images: [],
    jsonLdBlocks: [],
    blockedByRobotsTxt: false,
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

function image(overrides: Partial<ExtractedImage> = {}): ExtractedImage {
  return {
    hasAlt: false,
    altText: null,
    role: null,
    ariaHidden: null,
    width: null,
    height: null,
    ...overrides,
  };
}

describe("analyzePage — image alt text", () => {
  it("flags a meaningful image with no alt attribute at all", () => {
    const page = analyzePage(baseParams({ images: [image()] }));
    expect(issueTypes(page)).toContain("images_missing_alt");
    expect(page.issues.find((i) => i.type === "images_missing_alt")?.message).toContain("1 image");
  });

  it("does not flag an image that has alt text", () => {
    const page = analyzePage(
      baseParams({ images: [image({ hasAlt: true, altText: "A description" })] }),
    );
    expect(issueTypes(page)).not.toContain("images_missing_alt");
  });

  it("treats alt=\"\" as intentionally decorative and does not flag it", () => {
    const page = analyzePage(baseParams({ images: [image({ hasAlt: true, altText: "" })] }));
    expect(issueTypes(page)).not.toContain("images_missing_alt");
  });

  it("does not flag a structurally decorative image (role=presentation) missing alt", () => {
    const page = analyzePage(baseParams({ images: [image({ role: "presentation" })] }));
    expect(issueTypes(page)).not.toContain("images_missing_alt");
  });

  it("does not flag an aria-hidden image missing alt", () => {
    const page = analyzePage(baseParams({ images: [image({ ariaHidden: "true" })] }));
    expect(issueTypes(page)).not.toContain("images_missing_alt");
  });

  it("does not flag a 1x1 tracking-pixel-shaped image missing alt", () => {
    const page = analyzePage(baseParams({ images: [image({ width: "1", height: "1" })] }));
    expect(issueTypes(page)).not.toContain("images_missing_alt");
  });

  it("does not blindly flag every image — a page with no images raises nothing", () => {
    const page = analyzePage(baseParams({ images: [] }));
    expect(issueTypes(page)).not.toContain("images_missing_alt");
  });

  it("raises exactly one finding for multiple missing-alt images on the same page", () => {
    const page = analyzePage(baseParams({ images: [image(), image(), image()] }));
    const matches = page.issues.filter((i) => i.type === "images_missing_alt");
    expect(matches).toHaveLength(1);
    expect(matches[0].message).toContain("3 images");
  });

  it("only counts the meaningful images among a mix of decorative and meaningful ones", () => {
    const page = analyzePage(
      baseParams({
        images: [
          image(), // meaningful, missing alt -> counted
          image({ hasAlt: true, altText: "" }), // decorative alt="" -> not counted
          image({ role: "presentation" }), // structurally decorative -> not counted
          image({ hasAlt: true, altText: "Has text" }), // has alt -> not counted
          image(), // meaningful, missing alt -> counted
        ],
      }),
    );
    const finding = page.issues.find((i) => i.type === "images_missing_alt");
    expect(finding?.message).toContain("2 images");
  });
});

function jsonLdObject(value: unknown): string {
  return JSON.stringify(value);
}

describe("analyzePage — structured data (JSON-LD)", () => {
  it("does not flag a single valid JSON-LD block", () => {
    const page = analyzePage(
      baseParams({
        jsonLdBlocks: [jsonLdObject({ "@context": "https://schema.org", "@type": "Organization" })],
      }),
    );
    expect(issueTypes(page)).not.toContain("invalid_structured_data");
  });

  it("flags malformed JSON-LD that cannot be parsed", () => {
    const page = analyzePage(baseParams({ jsonLdBlocks: ["{ this is not valid json"] }));
    expect(issueTypes(page)).toContain("invalid_structured_data");
  });

  it("flags a structured-data script whose content is empty", () => {
    const page = analyzePage(baseParams({ jsonLdBlocks: ["   "] }));
    expect(issueTypes(page)).toContain("invalid_structured_data");
  });

  it("flags JSON that parses but isn't a usable JSON-LD shape (a bare string)", () => {
    const page = analyzePage(baseParams({ jsonLdBlocks: [jsonLdObject("just a string")] }));
    expect(issueTypes(page)).toContain("invalid_structured_data");
  });

  it("does not flag a page with no structured data at all", () => {
    const page = analyzePage(baseParams({ jsonLdBlocks: [] }));
    expect(issueTypes(page)).not.toContain("invalid_structured_data");
  });

  it("raises one finding (not one per block) when multiple blocks include one malformed block", () => {
    const page = analyzePage(
      baseParams({
        jsonLdBlocks: [
          jsonLdObject({ "@type": "Organization" }),
          "{ broken",
          jsonLdObject({ "@type": "WebSite" }),
        ],
      }),
    );
    const matches = page.issues.filter((i) => i.type === "invalid_structured_data");
    expect(matches).toHaveLength(1);
    expect(matches[0].message).toContain("1 of 3");
  });

  it("does not flag when all of several JSON-LD blocks are valid", () => {
    const page = analyzePage(
      baseParams({
        jsonLdBlocks: [
          jsonLdObject({ "@type": "Organization" }),
          jsonLdObject([{ "@type": "BreadcrumbList" }]),
        ],
      }),
    );
    expect(issueTypes(page)).not.toContain("invalid_structured_data");
  });
});

describe("analyzePage — redirect transparency", () => {
  it("flags a page that redirected before loading successfully", () => {
    const page = analyzePage(
      baseParams({
        fetched: fetched({ finalUrl: "https://example.com/new-page", redirectCount: 1 }),
      }),
    );
    expect(issueTypes(page)).toContain("redirected");
    expect(page.finalUrl).toBe("https://example.com/new-page");
    expect(page.redirectCount).toBe(1);
  });

  it("does not flag a page that loaded directly with no redirects", () => {
    const page = analyzePage(baseParams());
    expect(issueTypes(page)).not.toContain("redirected");
    expect(page.redirectCount).toBe(0);
  });

  it("does not double-report a redirect that ultimately failed (already covered by http_error)", () => {
    const page = analyzePage(
      baseParams({
        fetched: fetched({
          status: null,
          html: null,
          error: "Too many redirects (limit 3).",
          finalUrl: "https://example.com/hop-3",
          redirectCount: 3,
        }),
      }),
    );
    expect(issueTypes(page)).toEqual(["http_error"]);
  });
});

describe("analyzePage — robots.txt blocking", () => {
  it("flags a page the caller determined is disallowed by robots.txt", () => {
    const page = analyzePage(baseParams({ blockedByRobotsTxt: true }));
    expect(issueTypes(page)).toContain("blocked_by_robots_txt");
  });

  it("does not flag a page that isn't disallowed", () => {
    const page = analyzePage(baseParams({ blockedByRobotsTxt: false }));
    expect(issueTypes(page)).not.toContain("blocked_by_robots_txt");
  });

  it("does not flag robots.txt blocking on a page that failed to fetch", () => {
    const page = analyzePage(
      baseParams({ fetched: fetched({ status: 500 }), blockedByRobotsTxt: true }),
    );
    expect(issueTypes(page)).toEqual(["http_error"]);
  });
});
