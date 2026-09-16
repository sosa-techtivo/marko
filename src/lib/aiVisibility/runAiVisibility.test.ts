import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./providers/openai", () => ({ callOpenAiWebSearch: vi.fn() }));

const { callOpenAiWebSearch } = await import("./providers/openai");
const { runAiVisibility } = await import("./runAiVisibility");

const mockedCallOpenAiWebSearch = vi.mocked(callOpenAiWebSearch);

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

  it("never calls the provider when there are no questions", async () => {
    const outcomes = await runAiVisibility([], "https://acmecorp.com", "Acme Corp");
    expect(outcomes).toEqual([]);
    expect(mockedCallOpenAiWebSearch).not.toHaveBeenCalled();
  });
});
