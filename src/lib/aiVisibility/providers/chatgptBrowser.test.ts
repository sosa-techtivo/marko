import { describe, expect, it } from "vitest";
import { describeChatGptBlockedPage, parseChatGptSourcePayloads } from "./chatgptBrowser";

describe("parseChatGptSourcePayloads", () => {
  it("parses every payload, deduplicates by URL, keeps URLs as linked, and derives domains", () => {
    const sources = parseChatGptSourcePayloads([
      JSON.stringify([
        { title: "Software Development in Colombia — TechVendorIndex", url: "https://www.techvendorindex.com/co/?utm_source=chatgpt.com", attribution: "TechVendorIndex" },
        { title: "ITProfiles", url: "https://itprofiles.com/co?utm_source=chatgpt.com" },
      ]),
      JSON.stringify([
        { title: "Duplicate", url: "https://www.techvendorindex.com/co/?utm_source=chatgpt.com" },
        { title: "  ", url: "https://www.acmecorp.com/" },
      ]),
    ]);

    expect(sources).toEqual([
      {
        url: "https://www.techvendorindex.com/co/?utm_source=chatgpt.com",
        title: "Software Development in Colombia — TechVendorIndex",
        domain: "techvendorindex.com",
        startIndex: null,
        endIndex: null,
      },
      { url: "https://itprofiles.com/co?utm_source=chatgpt.com", title: "ITProfiles", domain: "itprofiles.com", startIndex: null, endIndex: null },
      { url: "https://www.acmecorp.com/", title: null, domain: "acmecorp.com", startIndex: null, endIndex: null },
    ]);
  });

  it("skips malformed payloads, non-array payloads, and non-http(s) URLs without failing", () => {
    expect(
      parseChatGptSourcePayloads([
        "not json",
        JSON.stringify({ url: "https://x.com" }),
        JSON.stringify([{ url: "javascript:alert(1)" }, { url: 42 }, { title: "no url" }]),
      ]),
    ).toEqual([]);
  });
});

describe("describeChatGptBlockedPage", () => {
  it("returns null for the ChatGPT chat itself", () => {
    expect(describeChatGptBlockedPage("https://chatgpt.com/uc/abc", "ChatGPT")).toBeNull();
  });

  it("explains Cloudflare verification, login, and unexpected pages without bypassing them", () => {
    expect(describeChatGptBlockedPage("https://chatgpt.com/", "Just a moment...")).toMatch(/Cloudflare/);
    expect(describeChatGptBlockedPage("https://auth.openai.com/log-in", "Log in")).toMatch(/login/);
    expect(describeChatGptBlockedPage("https://example.com/", "Example")).toMatch(/unexpected/);
  });
});
