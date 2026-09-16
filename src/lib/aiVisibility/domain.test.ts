import { describe, expect, it } from "vitest";
import { normalizeHostname } from "./domain";

describe("normalizeHostname", () => {
  it("lowercases the hostname", () => {
    expect(normalizeHostname("https://Example.COM/page")).toBe("example.com");
  });

  it("strips a leading www.", () => {
    expect(normalizeHostname("https://www.example.com/page")).toBe("example.com");
  });

  it("ignores path/query/fragment differences", () => {
    expect(normalizeHostname("https://example.com/a/b?x=1#y")).toBe("example.com");
  });

  it("treats different subdomains as different hostnames", () => {
    expect(normalizeHostname("https://blog.example.com")).toBe("blog.example.com");
  });

  it("returns null for an unparsable URL", () => {
    expect(normalizeHostname("not-a-url")).toBeNull();
  });
});
