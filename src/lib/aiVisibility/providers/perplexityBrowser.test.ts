import { describe, expect, it } from "vitest";
import { buildPerplexitySources, describePerplexityBlockedPage, isPerplexityAnswerText } from "./perplexityBrowser";

describe("buildPerplexitySources", () => {
  it("keeps only external http(s) answer links, deduplicated by URL, with title-like labels as titles", () => {
    const sources = buildPerplexitySources([
      { href: "https://clutch.co/co/developers", label: "clutch+2" },
      { href: "https://clutch.co/co/developers", label: "1" },
      { href: "https://www.goodfirms.co/colombia", label: "Top Software Development Companies in Colombia" },
      { href: "https://www.perplexity.ai/search/abc", label: "Related" },
      { href: "https://pplx.ai/share/x", label: "Share" },
      { href: "mailto:hello@example.com", label: "Email" },
      { href: "not a url", label: "Broken" },
    ]);

    expect(sources).toEqual([
      { url: "https://clutch.co/co/developers", title: null, domain: "clutch.co", startIndex: null, endIndex: null },
      {
        url: "https://www.goodfirms.co/colombia",
        title: "Top Software Development Companies in Colombia",
        domain: "goodfirms.co",
        startIndex: null,
        endIndex: null,
      },
    ]);
  });
});

describe("describePerplexityBlockedPage", () => {
  it("returns null for a normal answer page", () => {
    expect(describePerplexityBlockedPage("Which companies? - Perplexity", "Here are several companies…")).toBeNull();
  });

  it("reports Cloudflare verification and the sign-in wall (observed live) without bypassing them", () => {
    expect(describePerplexityBlockedPage("Just a moment...", "")).toMatch(/Cloudflare/);
    expect(describePerplexityBlockedPage("Perplexity", "Performing security verification")).toMatch(/Cloudflare/);
    expect(describePerplexityBlockedPage("Perplexity", "Sign in to continue using Perplexity")).toMatch(/sign-in/);
    expect(describePerplexityBlockedPage("Perplexity", "Sign up and repeat your request.")).toMatch(/sign-in/);
  });
});

describe("isPerplexityAnswerText", () => {
  const question = "Which software development companies in Colombia should I consider?";

  it("rejects the submitted question echoed back as the answer (observed live) and empty text", () => {
    expect(isPerplexityAnswerText(question, question)).toBe(false);
    expect(isPerplexityAnswerText(`  ${question.toUpperCase()}\n`, question)).toBe(false);
    expect(isPerplexityAnswerText("   ", question)).toBe(false);
  });

  it("accepts a real answer", () => {
    expect(isPerplexityAnswerText("Several Colombian firms stand out: Globant, Wawandco…", question)).toBe(true);
  });
});
