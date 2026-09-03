import { describe, expect, it } from "vitest";
import { applyCrossPageChecks } from "./crossPageChecks";
import type { AnalyzedPage, CrawlIssueType } from "./analyze";

function page(overrides: Partial<AnalyzedPage> & { url: string }): AnalyzedPage {
  return {
    httpStatus: 200,
    title: "A unique title",
    metaDescription: "A unique meta description for this page.",
    canonicalUrl: overrides.url,
    h1: "Heading",
    isIndexable: true,
    robotsDirectives: null,
    internalLinkCount: 0,
    fetchError: null,
    issues: [],
    ...overrides,
  };
}

function issueTypesFor(pages: AnalyzedPage[], url: string): CrawlIssueType[] {
  const found = pages.find((p) => p.url === url);
  if (!found) throw new Error(`no page found for ${url}`);
  return found.issues.map((issue) => issue.type);
}

describe("applyCrossPageChecks — duplicate title/meta description", () => {
  it("flags pages that share an identical title", () => {
    const pages = [
      page({ url: "https://example.com/a", title: "Same Title" }),
      page({ url: "https://example.com/b", title: "Same Title" }),
      page({ url: "https://example.com/c", title: "Different Title" }),
    ];
    const result = applyCrossPageChecks(pages);
    expect(issueTypesFor(result, "https://example.com/a")).toContain("duplicate_title");
    expect(issueTypesFor(result, "https://example.com/b")).toContain("duplicate_title");
    expect(issueTypesFor(result, "https://example.com/c")).not.toContain("duplicate_title");
  });

  it("does not flag a title that appears on only one page", () => {
    const pages = [page({ url: "https://example.com/a", title: "Unique" })];
    const result = applyCrossPageChecks(pages);
    expect(issueTypesFor(result, "https://example.com/a")).not.toContain("duplicate_title");
  });

  it("flags pages that share an identical meta description", () => {
    const pages = [
      page({ url: "https://example.com/a", metaDescription: "Same description" }),
      page({ url: "https://example.com/b", metaDescription: "Same description" }),
    ];
    const result = applyCrossPageChecks(pages);
    expect(issueTypesFor(result, "https://example.com/a")).toContain(
      "duplicate_meta_description",
    );
    expect(issueTypesFor(result, "https://example.com/b")).toContain(
      "duplicate_meta_description",
    );
  });
});

describe("applyCrossPageChecks — duplicate canonical consolidation", () => {
  it("flags two distinct pages deferring to the same third page", () => {
    const pages = [
      page({ url: "https://example.com/hub", canonicalUrl: "https://example.com/hub" }),
      page({ url: "https://example.com/a", canonicalUrl: "https://example.com/hub" }),
      page({ url: "https://example.com/b", canonicalUrl: "https://example.com/hub" }),
    ];
    const result = applyCrossPageChecks(pages);
    expect(issueTypesFor(result, "https://example.com/a")).toContain("duplicate_canonical");
    expect(issueTypesFor(result, "https://example.com/b")).toContain("duplicate_canonical");
    // The hub page itself (self-referencing) is never flagged.
    expect(issueTypesFor(result, "https://example.com/hub")).not.toContain("duplicate_canonical");
  });

  it("does not flag a single page deferring to another — ordinary canonical usage", () => {
    const pages = [
      page({ url: "https://example.com/hub", canonicalUrl: "https://example.com/hub" }),
      page({ url: "https://example.com/a", canonicalUrl: "https://example.com/hub" }),
    ];
    const result = applyCrossPageChecks(pages);
    expect(issueTypesFor(result, "https://example.com/a")).not.toContain("duplicate_canonical");
  });

  it("excludes pages with an existing invalid_canonical finding from consolidation grouping", () => {
    const pages = [
      page({
        url: "https://example.com/a",
        canonicalUrl: "https://broken.example/target",
        issues: [{ type: "invalid_canonical", severity: "warning", message: "broken" }],
      }),
      page({
        url: "https://example.com/b",
        canonicalUrl: "https://broken.example/target",
        issues: [{ type: "invalid_canonical", severity: "warning", message: "broken" }],
      }),
    ];
    const result = applyCrossPageChecks(pages);
    expect(issueTypesFor(result, "https://example.com/a")).not.toContain("duplicate_canonical");
    expect(issueTypesFor(result, "https://example.com/b")).not.toContain("duplicate_canonical");
  });
});

describe("applyCrossPageChecks — canonical chains", () => {
  it("flags a page whose canonical target is itself not self-referencing", () => {
    const pages = [
      page({ url: "https://example.com/a", canonicalUrl: "https://example.com/b" }),
      page({ url: "https://example.com/b", canonicalUrl: "https://example.com/c" }),
      page({ url: "https://example.com/c", canonicalUrl: "https://example.com/c" }),
    ];
    const result = applyCrossPageChecks(pages);
    expect(issueTypesFor(result, "https://example.com/a")).toContain("canonical_chain");
    // B's own canonical (pointing to C) is a normal single defer — not
    // itself flagged as a chain (it's the source of a duplicate check
    // scenario only if 2+ pages deferred to C, which isn't the case here).
    expect(issueTypesFor(result, "https://example.com/b")).not.toContain("canonical_chain");
  });

  it("flags a two-page cycle (A -> B -> A)", () => {
    const pages = [
      page({ url: "https://example.com/a", canonicalUrl: "https://example.com/b" }),
      page({ url: "https://example.com/b", canonicalUrl: "https://example.com/a" }),
    ];
    const result = applyCrossPageChecks(pages);
    expect(issueTypesFor(result, "https://example.com/a")).toContain("canonical_chain");
    expect(issueTypesFor(result, "https://example.com/b")).toContain("canonical_chain");
  });

  it("does not flag a canonical target that self-references (ordinary usage)", () => {
    const pages = [
      page({ url: "https://example.com/a", canonicalUrl: "https://example.com/hub" }),
      page({ url: "https://example.com/hub", canonicalUrl: "https://example.com/hub" }),
    ];
    const result = applyCrossPageChecks(pages);
    expect(issueTypesFor(result, "https://example.com/a")).not.toContain("canonical_chain");
  });

  it("does not flag a canonical target that wasn't crawled in this run", () => {
    const pages = [
      page({ url: "https://example.com/a", canonicalUrl: "https://example.com/not-crawled" }),
    ];
    const result = applyCrossPageChecks(pages);
    expect(issueTypesFor(result, "https://example.com/a")).not.toContain("canonical_chain");
  });

  it("does not flag a page that is already reported as invalid_canonical", () => {
    const pages = [
      page({
        url: "https://example.com/a",
        canonicalUrl: "https://example.com/b",
        issues: [{ type: "invalid_canonical", severity: "warning", message: "broken" }],
      }),
      page({ url: "https://example.com/b", canonicalUrl: "https://example.com/c" }),
      page({ url: "https://example.com/c", canonicalUrl: "https://example.com/c" }),
    ];
    const result = applyCrossPageChecks(pages);
    expect(issueTypesFor(result, "https://example.com/a")).not.toContain("canonical_chain");
  });
});
