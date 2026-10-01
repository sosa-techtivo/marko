import { describe, expect, it } from "vitest";
import { formatProviderSummaries, groupResultsByQuestion, summarizeResultsByProvider } from "./runDetail";
import { aiVisibilityProviderLabel } from "./providerLabels";

describe("groupResultsByQuestion", () => {
  it("groups by question in first-seen order, with Gemini before ChatGPT", () => {
    const groups = groupResultsByQuestion([
      { id: "1", questionId: "q2", provider: "openai" },
      { id: "2", questionId: "q1", provider: "openai" },
      { id: "3", questionId: "q2", provider: "gemini" },
      { id: "4", questionId: "q1", provider: "gemini" },
      { id: "6", questionId: "q1", provider: "anthropic" },
      { id: "5", questionId: "q1", provider: "perplexity" },
    ]);
    expect(groups.map((g) => [g.questionId, g.results.map((r) => r.id)])).toEqual([
      ["q2", ["3", "1"]],
      ["q1", ["4", "2", "5", "6"]],
    ]);
  });
});

describe("summarizeResultsByProvider", () => {
  it("counts succeeded/total per provider so one provider's failure stays visible", () => {
    const summaries = summarizeResultsByProvider(
      [
        { provider: "openai", status: "failed" },
        { provider: "gemini", status: "completed" },
        { provider: "openai", status: "completed" },
        { provider: "gemini", status: "completed" },
      ],
      "browser",
    );
    expect(formatProviderSummaries(summaries)).toBe("Gemini 2/2 · ChatGPT 1/2");
  });

  it("orders and labels three Browser providers, keeping a failed Perplexity visible", () => {
    const summaries = summarizeResultsByProvider(
      [
        { provider: "perplexity", status: "failed" },
        { provider: "openai", status: "completed" },
        { provider: "gemini", status: "completed" },
      ],
      "browser",
    );
    expect(formatProviderSummaries(summaries)).toBe("Gemini 1/1 · ChatGPT 1/1 · Perplexity 0/1");
  });

  it("orders and labels four Browser providers with truthful per-provider counts", () => {
    const summaries = summarizeResultsByProvider(
      [
        { provider: "anthropic", status: "failed" },
        { provider: "perplexity", status: "failed" },
        { provider: "openai", status: "completed" },
        { provider: "gemini", status: "completed" },
      ],
      "browser",
    );
    expect(formatProviderSummaries(summaries)).toBe("Gemini 1/1 · ChatGPT 1/1 · Perplexity 0/1 · Claude 0/1");
  });
});

describe("aiVisibilityProviderLabel", () => {
  it("names ChatGPT for browser OpenAI results and OpenAI for API ones", () => {
    expect(aiVisibilityProviderLabel("openai", "browser")).toBe("ChatGPT");
    expect(aiVisibilityProviderLabel("openai", "api")).toBe("OpenAI");
    expect(aiVisibilityProviderLabel("gemini", "browser")).toBe("Gemini");
    expect(aiVisibilityProviderLabel("perplexity", "browser")).toBe("Perplexity");
    expect(aiVisibilityProviderLabel("anthropic", "browser")).toBe("Claude");
  });
});
