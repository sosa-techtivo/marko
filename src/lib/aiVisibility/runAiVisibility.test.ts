import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiVisibilityProviderResult, AiVisibilitySource } from "./providers/types";

vi.mock("./providers/openai", () => ({ callOpenAiWebSearch: vi.fn() }));
vi.mock("./providers/geminiBrowser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./providers/geminiBrowser")>()),
  openGeminiBrowserSession: vi.fn(),
}));

vi.mock("./providers/chatgptBrowser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./providers/chatgptBrowser")>()),
  openChatGptBrowserSession: vi.fn(),
}));

vi.mock("./providers/perplexityBrowser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./providers/perplexityBrowser")>()),
  openPerplexityBrowserSession: vi.fn(),
}));

vi.mock("./providers/claudeBrowser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./providers/claudeBrowser")>()),
  openClaudeBrowserSession: vi.fn(),
}));

const { callOpenAiWebSearch } = await import("./providers/openai");
const { openClaudeBrowserSession } = await import("./providers/claudeBrowser");
const { openPerplexityBrowserSession } = await import("./providers/perplexityBrowser");
const { openChatGptBrowserSession } = await import("./providers/chatgptBrowser");
const { openGeminiBrowserSession, releaseGeminiBrowserLock, tryAcquireGeminiBrowserLock } = await import(
  "./providers/geminiBrowser"
);
const { resolveAiVisibilityRunCompletion, runAiVisibility } = await import("./runAiVisibility");

const mockedCallOpenAiWebSearch = vi.mocked(callOpenAiWebSearch);
const mockedOpenGeminiBrowserSession = vi.mocked(openGeminiBrowserSession);
const mockedOpenChatGptBrowserSession = vi.mocked(openChatGptBrowserSession);
const mockedOpenPerplexityBrowserSession = vi.mocked(openPerplexityBrowserSession);
const mockedOpenClaudeBrowserSession = vi.mocked(openClaudeBrowserSession);

afterEach(() => {
  vi.clearAllMocks();
});

describe("runAiVisibility", () => {
  it("returns one outcome per question, in the same order, even when some fail", async () => {
    mockedCallOpenAiWebSearch
      .mockResolvedValueOnce({
        ok: true,
        provider: "openai",
        model: "test-model",
        answerText: "Acme Corp is great.",
        sources: [],
        usage: null,
        raw: {},
      })
      .mockResolvedValueOnce({
        ok: false,
        provider: "openai",
        model: "test-model",
        error: "OpenAI rate-limited this request. Please try again shortly.",
      })
      .mockResolvedValueOnce({
        ok: true,
        provider: "openai",
        model: "test-model",
        answerText: "No mention here.",
        sources: [],
        usage: null,
        raw: {},
      });

    const outcomes = await runAiVisibility(
      [
        { id: "q1", questionText: "Question 1" },
        { id: "q2", questionText: "Question 2" },
        { id: "q3", questionText: "Question 3" },
      ],
      "https://acmecorp.com",
      "Acme Corp",
    );

    expect(outcomes.map((o) => o.questionId)).toEqual(["q1", "q2", "q3"]);
    expect(outcomes[0].status).toBe("completed");
    expect(outcomes[1].status).toBe("failed");
    expect(outcomes[2].status).toBe("completed");

    // The failed question in the middle never erases the successful
    // question that follows it in the same run.
    if (outcomes[2].status !== "completed") throw new Error("expected q3 to complete");
    expect(outcomes[2].answerText).toBe("No mention here.");
  });

  it("computes Mentioned/Cited/Prominence for each completed question from the provider's own result", async () => {
    mockedCallOpenAiWebSearch.mockResolvedValueOnce({
      ok: true,
      provider: "openai",
      model: "test-model",
      answerText: "For financing, Acme Corp is a strong option.",
      sources: [{ url: "https://acmecorp.com/pricing", title: "Pricing", domain: "acmecorp.com", startIndex: null, endIndex: null }],
      usage: { input_tokens: 5 },
      raw: { id: "resp_1" },
    });

    const [outcome] = await runAiVisibility(
      [{ id: "q1", questionText: "Who offers financing?" }],
      "https://acmecorp.com",
      "Acme Corp",
    );

    if (outcome.status !== "completed") throw new Error("expected completed outcome");
    expect(outcome.mentioned).toBe(true);
    expect(outcome.cited).toBe(true);
    expect(outcome.firstMentionIndex).toBe(15);
    expect(outcome.usage).toEqual({ input_tokens: 5 });
  });

  it("carries a provider failure's sanitized diagnostics onto the failed outcome", async () => {
    mockedCallOpenAiWebSearch.mockResolvedValueOnce({
      ok: false,
      provider: "openai",
      model: "test-model",
      error: "No quota.",
      diagnostics: { httpStatus: 429, errorStatus: "RESOURCE_EXHAUSTED" },
    });

    const [outcome] = await runAiVisibility([{ id: "q1", questionText: "Q" }], "https://acmecorp.com", "Acme Corp");

    expect(outcome).toEqual(
      expect.objectContaining({ status: "failed", raw: { httpStatus: 429, errorStatus: "RESOURCE_EXHAUSTED" } }),
    );
  });

  it("never calls the provider when there are no questions", async () => {
    const outcomes = await runAiVisibility([], "https://acmecorp.com", "Acme Corp");
    expect(outcomes).toEqual([]);
    expect(mockedCallOpenAiWebSearch).not.toHaveBeenCalled();
  });
});

describe("runAiVisibility — browser execution method (Gemini, ChatGPT, Perplexity, Claude web)", () => {
  const questions = [
    { id: "q1", questionText: "Who offers financing?" },
    { id: "q2", questionText: "Who has the best rates?" },
  ];

  type Ask = (questionText: string) => Promise<AiVisibilityProviderResult>;

  function answer(
    provider: "gemini" | "openai" | "perplexity" | "anthropic",
    model: string,
    answerText: string,
    sources: AiVisibilitySource[] = [],
  ) {
    return { ok: true as const, provider, model, answerText, sources, usage: null, raw: { executionMethod: "browser" } };
  }

  function session(ask: Ask) {
    return { ok: true as const, session: { ask, close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) } };
  }

  it("asks every question to all three providers with the exact same text, one outcome per question per provider", async () => {
    const geminiAsk = vi
      .fn<Ask>()
      .mockResolvedValueOnce(
        answer("gemini", "gemini-web (Flash-Lite)", "For financing, Acme Corp is a strong option.", [
          { url: "https://acmecorp.com/", title: "Acme", domain: "acmecorp.com", startIndex: null, endIndex: null },
        ]),
      )
      .mockResolvedValueOnce({ ok: false, provider: "gemini", model: "gemini-web (Flash-Lite)", error: "Timed out." });
    const chatgptAsk = vi
      .fn<Ask>()
      .mockResolvedValueOnce(answer("openai", "chatgpt-web", "Consider Globex."))
      .mockResolvedValueOnce(answer("openai", "chatgpt-web", "Acme Corp has good rates."));
    const perplexityAsk = vi
      .fn<Ask>()
      .mockResolvedValueOnce(answer("perplexity", "perplexity-web", "Initech is popular."))
      .mockResolvedValueOnce({ ok: false, provider: "perplexity", model: "perplexity-web", error: "Sign-in required." });
    const claudeAsk = vi
      .fn<Ask>()
      .mockResolvedValueOnce(answer("anthropic", "claude-web", "Hooli builds products."))
      .mockResolvedValueOnce(answer("anthropic", "claude-web", "Acme Corp is reliable."));
    const gemini = session(geminiAsk);
    const chatgpt = session(chatgptAsk);
    const perplexity = session(perplexityAsk);
    const claude = session(claudeAsk);
    mockedOpenGeminiBrowserSession.mockResolvedValue(gemini);
    mockedOpenChatGptBrowserSession.mockResolvedValue(chatgpt);
    mockedOpenPerplexityBrowserSession.mockResolvedValue(perplexity);
    mockedOpenClaudeBrowserSession.mockResolvedValue(claude);

    const outcomes = await runAiVisibility(questions, "https://acmecorp.com", "Acme Corp", "browser");

    for (const ask of [geminiAsk, chatgptAsk, perplexityAsk, claudeAsk]) {
      expect(ask.mock.calls.map((call) => call[0])).toEqual(["Who offers financing?", "Who has the best rates?"]);
    }
    for (const opened of [gemini, chatgpt, perplexity, claude]) expect(opened.session.close).toHaveBeenCalledTimes(1);
    expect(mockedCallOpenAiWebSearch).not.toHaveBeenCalled();

    expect(outcomes.map((o) => [o.questionId, o.provider, o.status])).toEqual([
      ["q1", "gemini", "completed"],
      ["q1", "openai", "completed"],
      ["q1", "perplexity", "completed"],
      ["q1", "anthropic", "completed"],
      ["q2", "gemini", "failed"],
      ["q2", "openai", "completed"],
      ["q2", "perplexity", "failed"],
      ["q2", "anthropic", "completed"],
    ]);
    // Same downstream metrics for each provider's own answer.
    const [geminiQ1, chatgptQ1, perplexityQ1, , , chatgptQ2, , claudeQ2] = outcomes;
    if (claudeQ2.status !== "completed") throw new Error("expected Claude q2 completed");
    expect(claudeQ2.mentioned).toBe(true);
    if (
      geminiQ1.status !== "completed" ||
      chatgptQ1.status !== "completed" ||
      perplexityQ1.status !== "completed" ||
      chatgptQ2.status !== "completed"
    ) {
      throw new Error("expected completed outcomes");
    }
    expect([geminiQ1.mentioned, geminiQ1.cited, geminiQ1.firstMentionIndex]).toEqual([true, true, 15]);
    expect([chatgptQ1.mentioned, chatgptQ1.cited]).toEqual([false, false]);
    expect([perplexityQ1.mentioned, perplexityQ1.cited]).toEqual([false, false]);
    expect(chatgptQ2.mentioned).toBe(true);
  });

  it("keeps Gemini's and ChatGPT's results when Perplexity and Claude are both blocked (observed live)", async () => {
    mockedOpenGeminiBrowserSession.mockResolvedValue(session(vi.fn<Ask>().mockResolvedValue(answer("gemini", "gemini-web", "Acme Corp."))));
    mockedOpenChatGptBrowserSession.mockResolvedValue(session(vi.fn<Ask>().mockResolvedValue(answer("openai", "chatgpt-web", "Globex."))));
    mockedOpenPerplexityBrowserSession.mockResolvedValue(
      session(vi.fn<Ask>().mockResolvedValue({ ok: false, provider: "perplexity", model: "perplexity-web", error: "P sign-in." })),
    );
    mockedOpenClaudeBrowserSession.mockResolvedValue(
      session(vi.fn<Ask>().mockResolvedValue({ ok: false, provider: "anthropic", model: "claude-web", error: "C sign-in." })),
    );

    const outcomes = await runAiVisibility(questions, "https://acmecorp.com", "Acme Corp", "browser");

    expect(outcomes).toHaveLength(8);
    expect(outcomes.filter((o) => o.provider === "gemini" || o.provider === "openai").every((o) => o.status === "completed")).toBe(true);
    expect(resolveAiVisibilityRunCompletion(outcomes)).toEqual({
      status: "completed",
      succeededCount: 4,
      failedCount: 4,
      errorMessage: "Perplexity: P sign-in. · Claude: C sign-in.",
    });
  });

  it("keeps Gemini's and ChatGPT's results when Perplexity is blocked, failing only Perplexity's outcomes", async () => {
    mockedOpenGeminiBrowserSession.mockResolvedValue(session(vi.fn<Ask>().mockResolvedValue(answer("gemini", "gemini-web", "Acme Corp."))));
    mockedOpenChatGptBrowserSession.mockResolvedValue(session(vi.fn<Ask>().mockResolvedValue(answer("openai", "chatgpt-web", "Globex."))));
    const blocked = "Perplexity web required sign-in for this request.";
    mockedOpenPerplexityBrowserSession.mockResolvedValue(
      session(vi.fn<Ask>().mockResolvedValue({ ok: false, provider: "perplexity", model: "perplexity-web", error: blocked })),
    );
    mockedOpenClaudeBrowserSession.mockResolvedValue(
      session(vi.fn<Ask>().mockResolvedValue(answer("anthropic", "claude-web", "Hooli."))),
    );

    const outcomes = await runAiVisibility(questions, "https://acmecorp.com", "Acme Corp", "browser");

    expect(outcomes.filter((o) => o.provider !== "perplexity").every((o) => o.status === "completed")).toBe(true);
    expect(outcomes.filter((o) => o.provider === "perplexity").every((o) => o.status === "failed")).toBe(true);
    expect(resolveAiVisibilityRunCompletion(outcomes)).toEqual({
      status: "completed",
      succeededCount: 6,
      failedCount: 2,
      errorMessage: `Perplexity: ${blocked}`,
    });
  });

  it("keeps the other providers' results when ChatGPT cannot launch, failing only ChatGPT's outcomes", async () => {
    mockedOpenGeminiBrowserSession.mockResolvedValue(session(vi.fn<Ask>().mockResolvedValue(answer("gemini", "gemini-web", "Acme Corp."))));
    mockedOpenChatGptBrowserSession.mockResolvedValue({ ok: false, error: "Could not start the browser for ChatGPT." });
    mockedOpenPerplexityBrowserSession.mockResolvedValue(
      session(vi.fn<Ask>().mockResolvedValue(answer("perplexity", "perplexity-web", "Initech."))),
    );
    mockedOpenClaudeBrowserSession.mockResolvedValue(session(vi.fn<Ask>().mockResolvedValue(answer("anthropic", "claude-web", "Hooli."))));

    const outcomes = await runAiVisibility(questions, "https://acmecorp.com", "Acme Corp", "browser");

    expect(
      outcomes
        .filter((o) => o.provider === "openai")
        .every((o) => o.status === "failed" && o.errorMessage === "Could not start the browser for ChatGPT." && o.model === "chatgpt-web"),
    ).toBe(true);
    expect(outcomes.filter((o) => o.provider !== "openai").every((o) => o.status === "completed")).toBe(true);
  });

  it("refuses to start a second concurrent browser run, without launching any browser", async () => {
    expect(tryAcquireGeminiBrowserLock()).toBe(true);
    try {
      const outcomes = await runAiVisibility(questions, "https://acmecorp.com", "Acme Corp", "browser");
      expect(outcomes).toHaveLength(8);
      expect(outcomes.every((o) => o.status === "failed" && /already running/.test(o.errorMessage))).toBe(true);
      expect(mockedOpenGeminiBrowserSession).not.toHaveBeenCalled();
      expect(mockedOpenChatGptBrowserSession).not.toHaveBeenCalled();
      expect(mockedOpenPerplexityBrowserSession).not.toHaveBeenCalled();
      expect(mockedOpenClaudeBrowserSession).not.toHaveBeenCalled();
    } finally {
      releaseGeminiBrowserLock();
    }
  });

  it("releases the browser lock and closes every session even if asking throws", async () => {
    const gemini = session(vi.fn<Ask>().mockRejectedValue(new Error("boom")));
    const chatgpt = session(vi.fn<Ask>().mockResolvedValue(answer("openai", "chatgpt-web", "x")));
    const perplexity = session(vi.fn<Ask>().mockResolvedValue(answer("perplexity", "perplexity-web", "y")));
    const claude = session(vi.fn<Ask>().mockResolvedValue(answer("anthropic", "claude-web", "z")));
    mockedOpenGeminiBrowserSession.mockResolvedValue(gemini);
    mockedOpenChatGptBrowserSession.mockResolvedValue(chatgpt);
    mockedOpenPerplexityBrowserSession.mockResolvedValue(perplexity);
    mockedOpenClaudeBrowserSession.mockResolvedValue(claude);

    await expect(runAiVisibility(questions, "https://acmecorp.com", "Acme Corp", "browser")).rejects.toThrow("boom");
    for (const opened of [gemini, chatgpt, perplexity, claude]) expect(opened.session.close).toHaveBeenCalledTimes(1);
    expect(tryAcquireGeminiBrowserLock()).toBe(true);
    releaseGeminiBrowserLock();
  });
});

describe("resolveAiVisibilityRunCompletion — multi-provider (Browser) runs", () => {
  function outcome(provider: "gemini" | "openai", status: "completed" | "failed", errorMessage = "Failed.") {
    return status === "completed"
      ? {
          questionId: "q1",
          status,
          provider,
          model: "m",
          answerText: "a",
          sources: [],
          mentioned: false,
          cited: false,
          firstMentionIndex: null,
          usage: null,
          raw: {},
        }
      : { questionId: "q1", status, provider, model: "m", errorMessage };
  }

  it("both succeeded → completed with no message", () => {
    expect(resolveAiVisibilityRunCompletion([outcome("gemini", "completed"), outcome("openai", "completed")])).toEqual({
      status: "completed",
      succeededCount: 2,
      failedCount: 0,
      errorMessage: null,
    });
  });

  it("Gemini failed, ChatGPT succeeded → completed, naming Gemini's failure", () => {
    expect(
      resolveAiVisibilityRunCompletion([outcome("gemini", "failed", "Gemini timed out."), outcome("openai", "completed")]),
    ).toEqual({ status: "completed", succeededCount: 1, failedCount: 1, errorMessage: "Gemini: Gemini timed out." });
  });

  it("both failed → failed, naming each provider's failure", () => {
    expect(
      resolveAiVisibilityRunCompletion([outcome("gemini", "failed", "G down."), outcome("openai", "failed", "C blocked.")]),
    ).toEqual({ status: "failed", succeededCount: 0, failedCount: 2, errorMessage: "Gemini: G down. · ChatGPT: C blocked." });
  });
});

describe("resolveAiVisibilityRunCompletion", () => {
  const completed = {
    questionId: "q1",
    status: "completed" as const,
    provider: "gemini" as const,
    model: "test-model",
    answerText: "An answer.",
    sources: [],
    mentioned: false,
    cited: false,
    firstMentionIndex: null,
    usage: null,
    raw: {},
  };
  const failed = (questionId: string, errorMessage: string) => ({
    questionId,
    status: "failed" as const,
    provider: "gemini" as const,
    model: "test-model",
    errorMessage,
  });

  it("marks an all-succeeded run completed", () => {
    expect(resolveAiVisibilityRunCompletion([completed, { ...completed, questionId: "q2" }])).toEqual({
      status: "completed",
      succeededCount: 2,
      failedCount: 0,
      errorMessage: null,
    });
  });

  it("marks an all-failed run failed, reusing the shared per-question message", () => {
    expect(resolveAiVisibilityRunCompletion([failed("q1", "Rate limited."), failed("q2", "Rate limited.")])).toEqual({
      status: "failed",
      succeededCount: 0,
      failedCount: 2,
      errorMessage: "Rate limited.",
    });
  });

  it("marks an all-failed run with differing messages failed with a generic count message", () => {
    const result = resolveAiVisibilityRunCompletion([failed("q1", "Rate limited."), failed("q2", "Timed out.")]);
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBe("All 2 questions failed. See the individual question results for details.");
  });

  it("marks a mixed run completed (no partial status exists), with counts carrying the partial failure", () => {
    expect(resolveAiVisibilityRunCompletion([completed, failed("q2", "Rate limited.")])).toEqual({
      status: "completed",
      succeededCount: 1,
      failedCount: 1,
      errorMessage: null,
    });
  });
});
