import { describe, expect, it } from "vitest";
import { computeCited, computeFirstMentionIndex, computeMentioned } from "./metrics";
import type { AiVisibilitySource } from "./providers/types";

function source(overrides: Partial<AiVisibilitySource> = {}): AiVisibilitySource {
  return {
    url: "https://example.com/page",
    title: "Example",
    domain: "example.com",
    startIndex: null,
    endIndex: null,
    ...overrides,
  };
}

describe("computeMentioned", () => {
  it("is true when the brand name appears in the answer, case-insensitively", () => {
    expect(computeMentioned("We recommend Acme Corp for this.", "acme corp")).toBe(true);
  });

  it("is false when the brand name does not appear anywhere in the answer", () => {
    expect(computeMentioned("We recommend a different company.", "Acme Corp")).toBe(false);
  });

  it("is null (not evaluated) when the brand name is blank", () => {
    expect(computeMentioned("Some answer text.", "  ")).toBeNull();
  });
});

describe("computeFirstMentionIndex", () => {
  it("returns the character index of the first case-insensitive occurrence", () => {
    expect(computeFirstMentionIndex("Try Widgetco or Acme Corp today.", "Acme Corp")).toBe(16);
  });

  it("returns null when the brand is not mentioned", () => {
    expect(computeFirstMentionIndex("Try Widgetco today.", "Acme Corp")).toBeNull();
  });

  it("returns null when the brand name is blank", () => {
    expect(computeFirstMentionIndex("Some answer text.", "")).toBeNull();
  });
});

describe("computeCited", () => {
  it("is true when a source's domain exactly matches the site's domain", () => {
    const sources = [source({ domain: "example.com" })];
    expect(computeCited(sources, "https://example.com")).toBe(true);
  });

  it("is true when a source uses a www-prefixed hostname for the same site", () => {
    const sources = [source({ domain: "example.com" })];
    expect(computeCited(sources, "https://www.example.com/")).toBe(true);
  });

  it("is false when every source resolves to an unrelated external domain", () => {
    const sources = [source({ domain: "otherdomain.com" }), source({ domain: "third-party.org" })];
    expect(computeCited(sources, "https://example.com")).toBe(false);
  });

  it("is false (not true) merely because the brand name text appears — citations are evaluated only by domain", () => {
    const sources = [source({ domain: "unrelated-blog.com", title: "All about Acme Corp" })];
    expect(computeCited(sources, "https://acmecorp.com")).toBe(false);
  });

  it("is false when there are no sources at all", () => {
    expect(computeCited([], "https://example.com")).toBe(false);
  });

  it("ignores a source whose own URL failed to normalize to a domain", () => {
    const sources = [source({ domain: null })];
    expect(computeCited(sources, "https://example.com")).toBe(false);
  });

  it("returns null (not evaluated) when the site's own URL cannot be parsed", () => {
    expect(computeCited([source()], "not-a-valid-url")).toBeNull();
  });
});
