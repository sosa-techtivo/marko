import { describe, expect, it } from "vitest";
import { findExactPropertyMatch, type SearchConsoleProperty } from "./propertyMatching";

function property(siteUrl: string, permissionLevel = "siteOwner"): SearchConsoleProperty {
  return { siteUrl, permissionLevel };
}

describe("findExactPropertyMatch", () => {
  it("matches an exact url-prefix property", () => {
    const properties = [property("https://example.com/"), property("https://other.com/")];
    const match = findExactPropertyMatch("https://example.com", properties);
    expect(match).toEqual({ siteUrl: "https://example.com/", type: "url_prefix" });
  });

  it("matches even when the site's own registered URL has no trailing slash and the property does", () => {
    const properties = [property("https://example.com/")];
    expect(findExactPropertyMatch("https://example.com", properties)?.siteUrl).toBe(
      "https://example.com/",
    );
  });

  it("matches a domain property against the site's root domain", () => {
    const properties = [property("sc-domain:example.com")];
    const match = findExactPropertyMatch("https://example.com", properties);
    expect(match).toEqual({ siteUrl: "sc-domain:example.com", type: "domain" });
  });

  it("matches a domain property even when the site is registered with a www subdomain", () => {
    const properties = [property("sc-domain:example.com")];
    const match = findExactPropertyMatch("https://www.example.com", properties);
    expect(match).toEqual({ siteUrl: "sc-domain:example.com", type: "domain" });
  });

  it("does not match a url-prefix property with a different scheme", () => {
    // GSC treats http and https url-prefix properties as distinct
    // properties — an exact match should stay scheme-sensitive.
    const properties = [property("http://example.com/")];
    expect(findExactPropertyMatch("https://example.com", properties)).toBeNull();
  });

  it("does not match a url-prefix property for a different path", () => {
    const properties = [property("https://example.com/blog/")];
    expect(findExactPropertyMatch("https://example.com", properties)).toBeNull();
  });

  it("returns null when there is no matching property at all", () => {
    const properties = [property("https://unrelated.com/"), property("sc-domain:another.com")];
    expect(findExactPropertyMatch("https://example.com", properties)).toBeNull();
  });

  it("returns null for an empty property list", () => {
    expect(findExactPropertyMatch("https://example.com", [])).toBeNull();
  });

  it("prefers the exact url-prefix property over a domain property that also covers the same site", () => {
    // A domain property structurally covers this site too (its host, root-
    // domain-stripped, matches), but the url-prefix property is the more
    // specific, exact signal — this is not genuine ambiguity.
    const properties = [property("sc-domain:example.com"), property("https://example.com/")];
    expect(findExactPropertyMatch("https://example.com", properties)).toEqual({
      siteUrl: "https://example.com/",
      type: "url_prefix",
    });
  });

  it("prefers the exact url-prefix property over a covering domain property, www variant", () => {
    const properties = [property("sc-domain:example.com"), property("https://www.example.com/")];
    expect(findExactPropertyMatch("https://www.example.com", properties)).toEqual({
      siteUrl: "https://www.example.com/",
      type: "url_prefix",
    });
  });

  it("falls back to the domain property when the url-prefix property present doesn't match this site", () => {
    // The url-prefix property is for an unrelated path, so it never enters
    // the url-prefix candidate set — only the domain property remains, and
    // it alone is not ambiguous.
    const properties = [property("sc-domain:example.com"), property("https://example.com/blog/")];
    expect(findExactPropertyMatch("https://example.com", properties)).toEqual({
      siteUrl: "sc-domain:example.com",
      type: "domain",
    });
  });

  it("dedupes an identical duplicate property entry rather than treating it as ambiguous", () => {
    const properties = [property("https://example.com/"), property("https://example.com/")];
    expect(findExactPropertyMatch("https://example.com", properties)).toEqual({
      siteUrl: "https://example.com/",
      type: "url_prefix",
    });
  });

  it("returns null when the site's own URL is not a valid URL", () => {
    const properties = [property("https://example.com/")];
    expect(findExactPropertyMatch("not-a-url", properties)).toBeNull();
  });
});
