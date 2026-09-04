import { describe, expect, it } from "vitest";
import {
  deriveSeedEffectiveUrl,
  describeRegisteredUrlRedirect,
  resolveEffectiveSiteUrl,
} from "./effectiveUrl";

describe("deriveSeedEffectiveUrl", () => {
  it("no redirect: follows the successful final URL, which equals the registered URL", () => {
    expect(deriveSeedEffectiveUrl("https://example.com/", "https://example.com/")).toBe(
      "https://example.com/",
    );
  });

  it("registered URL redirects: the discovered final URL is what gets returned", () => {
    expect(deriveSeedEffectiveUrl("https://www.techtivo.com/", "https://techtivo.com")).toBe(
      "https://www.techtivo.com/",
    );
  });

  it("falls back to the registered URL when no final URL was recorded", () => {
    expect(deriveSeedEffectiveUrl(null, "https://example.com/")).toBe("https://example.com/");
  });
});

describe("resolveEffectiveSiteUrl", () => {
  it("uses the effective URL when one is available", () => {
    expect(
      resolveEffectiveSiteUrl({ url: "https://techtivo.com", effective_url: "https://www.techtivo.com/" }),
    ).toBe("https://www.techtivo.com/");
  });

  it("preserves current behavior (falls back to the registered URL) when effective_url is null", () => {
    expect(resolveEffectiveSiteUrl({ url: "https://example.com/", effective_url: null })).toBe(
      "https://example.com/",
    );
  });
});

describe("describeRegisteredUrlRedirect", () => {
  it("describes a real host redirect", () => {
    expect(
      describeRegisteredUrlRedirect("https://techtivo.com", "https://www.techtivo.com/"),
    ).toBe("techtivo.com redirects to www.techtivo.com");
  });

  it("returns null when there is no effective URL yet", () => {
    expect(describeRegisteredUrlRedirect("https://techtivo.com", null)).toBeNull();
  });

  it("returns null when the hosts match, even if the raw strings differ only by a trailing slash", () => {
    expect(
      describeRegisteredUrlRedirect("https://example.com", "https://example.com/"),
    ).toBeNull();
  });

  it("returns null when the hosts match but the path differs (not a host-level redirect)", () => {
    expect(
      describeRegisteredUrlRedirect("https://example.com/", "https://example.com/blog/"),
    ).toBeNull();
  });

  it("returns null when either URL fails to parse", () => {
    expect(describeRegisteredUrlRedirect("not-a-url", "https://example.com/")).toBeNull();
  });
});
