import { describe, expect, it } from "vitest";
import { buildClaudeSources, describeClaudeBlockedPage, isClaudeAnswerText } from "./claudeBrowser";

describe("describeClaudeBlockedPage", () => {
  it("returns null for the Claude chat itself", () => {
    expect(describeClaudeBlockedPage("https://claude.ai/new", "Claude", "How can I help you today?")).toBeNull();
  });

  it("reports the signed-out sign-in redirect (observed live) and Cloudflare verification, never bypassing them", () => {
    expect(describeClaudeBlockedPage("https://claude.ai/login?returnTo=%2Fnew", "Sign in - Claude", "Continue with Google")).toMatch(
      /requires sign-in/,
    );
    expect(describeClaudeBlockedPage("https://claude.ai/new", "Just a moment...", "")).toMatch(/Cloudflare/);
    expect(
      describeClaudeBlockedPage("https://claude.ai/login", "Just a moment...", "Performing security verification"),
    ).toMatch(/Cloudflare/);
    expect(describeClaudeBlockedPage("https://example.com/", "Example", "")).toMatch(/unexpected/);
  });
});

describe("isClaudeAnswerText", () => {
  const question = "Which software development companies in Colombia should I consider?";

  it("rejects the question echo and empty text", () => {
    expect(isClaudeAnswerText(question, question)).toBe(false);
    expect(isClaudeAnswerText(`\n ${question} `, question)).toBe(false);
    expect(isClaudeAnswerText("", question)).toBe(false);
  });

  it("accepts a real answer", () => {
    expect(isClaudeAnswerText("Here are some Colombian firms to consider: …", question)).toBe(true);
  });
});

describe("buildClaudeSources", () => {
  it("keeps external http(s) links only, deduplicated, excluding Claude/Anthropic hosts", () => {
    expect(
      buildClaudeSources([
        { href: "https://clutch.co/co", label: "Clutch — Top developers" },
        { href: "https://clutch.co/co", label: "1" },
        { href: "https://claude.ai/new", label: "New chat" },
        { href: "https://www.anthropic.com/legal/privacy", label: "Privacy" },
        { href: "https://support.claude.com/x", label: "Help" },
        { href: "javascript:void(0)", label: "x" },
      ]),
    ).toEqual([{ url: "https://clutch.co/co", title: "Clutch — Top developers", domain: "clutch.co", startIndex: null, endIndex: null }]);
  });
});
