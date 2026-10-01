import { afterEach, describe, expect, it } from "vitest";
import {
  buildGeminiBrowserSources,
  describeGeminiWebBlockedPage,
  geminiWebModelFromModeLabel,
  isGeminiBrowserEnabled,
  normalizeGeminiCitationUrl,
  parseGeminiSourceTitle,
} from "./geminiBrowser";

afterEach(() => {
  delete process.env.AI_VISIBILITY_BROWSER_ENABLED;
});

describe("isGeminiBrowserEnabled", () => {
  it("is off unless explicitly set to true", () => {
    expect(isGeminiBrowserEnabled()).toBe(false);
    process.env.AI_VISIBILITY_BROWSER_ENABLED = "1";
    expect(isGeminiBrowserEnabled()).toBe(false);
    process.env.AI_VISIBILITY_BROWSER_ENABLED = " TRUE ";
    expect(isGeminiBrowserEnabled()).toBe(true);
  });
});

describe("normalizeGeminiCitationUrl", () => {
  it("strips Gemini's text-fragment highlight but keeps ordinary hashes", () => {
    expect(normalizeGeminiCitationUrl("https://ideaware.co/blog/x/#:~:text=What%20are")).toBe("https://ideaware.co/blog/x/");
    expect(normalizeGeminiCitationUrl("https://example.com/page#section")).toBe("https://example.com/page#section");
  });

  it("rejects non-http(s) and unparseable links", () => {
    expect(normalizeGeminiCitationUrl("javascript:void(0)")).toBeNull();
    expect(normalizeGeminiCitationUrl("not a url")).toBeNull();
  });
});

describe("parseGeminiSourceTitle", () => {
  it("uses the page title line under the source name", () => {
    expect(parseGeminiSourceTitle("Ideaware\nBest Nearshore Companies 2026\n“Jobsity is…”")).toBe("Best Nearshore Companies 2026");
  });

  it("falls back to the only line, or null for empty text", () => {
    expect(parseGeminiSourceTitle("Ideaware")).toBe("Ideaware");
    expect(parseGeminiSourceTitle("  \n ")).toBeNull();
  });
});

describe("buildGeminiBrowserSources", () => {
  it("deduplicates by normalized URL and derives domains, with null offsets", () => {
    const sources = buildGeminiBrowserSources([
      { href: "https://www.acmecorp.com/pricing#:~:text=a", text: "Acme\nPricing" },
      { href: "https://www.acmecorp.com/pricing#:~:text=b", text: "Acme\nPricing again" },
      { href: "https://mismo.team/top-10/", text: "Mismo.team\nTop 10" },
      { href: "mailto:someone@example.com", text: "Email" },
    ]);

    expect(sources).toEqual([
      { url: "https://www.acmecorp.com/pricing", title: "Pricing", domain: "acmecorp.com", startIndex: null, endIndex: null },
      { url: "https://mismo.team/top-10/", title: "Top 10", domain: "mismo.team", startIndex: null, endIndex: null },
    ]);
  });
});

describe("geminiWebModelFromModeLabel", () => {
  it("records the web UI's current mode when readable", () => {
    expect(geminiWebModelFromModeLabel("Open mode picker, currently Flash-Lite")).toBe("gemini-web (Flash-Lite)");
  });

  it("falls back to a generic gemini-web label", () => {
    expect(geminiWebModelFromModeLabel(null)).toBe("gemini-web");
    expect(geminiWebModelFromModeLabel("Open mode picker")).toBe("gemini-web");
  });
});

describe("describeGeminiWebBlockedPage", () => {
  it("returns null for the Gemini app itself", () => {
    expect(describeGeminiWebBlockedPage("https://gemini.google.com/app")).toBeNull();
  });

  it("explains sign-in, consent, and CAPTCHA walls without bypassing them", () => {
    expect(describeGeminiWebBlockedPage("https://accounts.google.com/ServiceLogin?x=1")).toMatch(/sign-in/);
    expect(describeGeminiWebBlockedPage("https://consent.google.com/m?continue=x")).toMatch(/consent/);
    expect(describeGeminiWebBlockedPage("https://www.google.com/sorry/index?continue=x")).toMatch(/CAPTCHA/);
    expect(describeGeminiWebBlockedPage("https://example.com/")).toMatch(/unexpected/);
  });
});
