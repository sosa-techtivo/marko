import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockedFetch = vi.fn();
vi.stubGlobal("fetch", mockedFetch);

const { callOpenAiWebSearch } = await import("./openai");

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_MODEL = "test-model";
});

afterEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("callOpenAiWebSearch — configuration", () => {
  it("fails safely without calling the API when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;

    const result = await callOpenAiWebSearch("What is Acme Corp?");

    expect(result).toEqual({
      ok: false,
      provider: "openai",
      model: "test-model",
      error: "OPENAI_API_KEY is not configured.",
    });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("fails safely without calling the API when OPENAI_MODEL is missing", async () => {
    delete process.env.OPENAI_MODEL;

    const result = await callOpenAiWebSearch("What is Acme Corp?");

    expect(result).toEqual({
      ok: false,
      provider: "openai",
      model: "unknown",
      error: "OPENAI_MODEL is not configured.",
    });
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

describe("callOpenAiWebSearch — request shape", () => {
  it("sends the model, input, and web_search tool, with the API key as a bearer token", async () => {
    mockedFetch.mockResolvedValue(
      jsonResponse(200, {
        output: [{ type: "message", content: [{ type: "output_text", text: "An answer.", annotations: [] }] }],
      }),
    );

    await callOpenAiWebSearch("What is Acme Corp?");

    expect(mockedFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      }),
    );
    const requestBody = JSON.parse(mockedFetch.mock.calls[0][1].body);
    expect(requestBody).toEqual({
      model: "test-model",
      input: "What is Acme Corp?",
      tools: [{ type: "web_search" }],
    });
  });
});

describe("callOpenAiWebSearch — response parsing", () => {
  it("normalizes the answer text and url_citation annotations into sources", async () => {
    mockedFetch.mockResolvedValue(
      jsonResponse(200, {
        output: [
          { type: "web_search_call", action: { type: "search" } },
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "Acme Corp is a leading provider.",
                annotations: [
                  {
                    type: "url_citation",
                    url: "https://www.acmecorp.com/about",
                    title: "About Acme Corp",
                    start_index: 0,
                    end_index: 9,
                  },
                  { type: "url_citation", url: "not-a-valid-url", title: "Broken" },
                  { type: "file_citation", url: "https://ignored.example.com" },
                ],
              },
            ],
          },
        ],
        usage: { input_tokens: 12, output_tokens: 34 },
      }),
    );

    const result = await callOpenAiWebSearch("What is Acme Corp?");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.answerText).toBe("Acme Corp is a leading provider.");
    expect(result.sources).toEqual([
      {
        url: "https://www.acmecorp.com/about",
        title: "About Acme Corp",
        domain: "acmecorp.com",
        startIndex: 0,
        endIndex: 9,
      },
      {
        url: "not-a-valid-url",
        title: "Broken",
        domain: null,
        startIndex: null,
        endIndex: null,
      },
    ]);
    expect(result.usage).toEqual({ input_tokens: 12, output_tokens: 34 });
    expect(result.model).toBe("test-model");
  });

  it("treats a response with no message/output_text as an empty-answer failure", async () => {
    mockedFetch.mockResolvedValue(
      jsonResponse(200, { output: [{ type: "web_search_call", action: { type: "search" } }] }),
    );

    const result = await callOpenAiWebSearch("What is Acme Corp?");

    expect(result).toEqual({
      ok: false,
      provider: "openai",
      model: "test-model",
      error: "OpenAI returned an empty answer.",
    });
  });

  it("treats a blank output_text as an empty-answer failure", async () => {
    mockedFetch.mockResolvedValue(
      jsonResponse(200, {
        output: [{ type: "message", content: [{ type: "output_text", text: "   ", annotations: [] }] }],
      }),
    );

    const result = await callOpenAiWebSearch("What is Acme Corp?");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.error).toBe("OpenAI returned an empty answer.");
  });

  it("maps a 401 response to a safe, non-raw error message", async () => {
    mockedFetch.mockResolvedValue(jsonResponse(401, { error: { message: "Invalid API key: sk-abc123" } }));

    const result = await callOpenAiWebSearch("What is Acme Corp?");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.error).not.toContain("sk-abc123");
    expect(result.error).toContain("invalid or revoked");
  });

  it("maps a 429 response to a rate-limit message", async () => {
    mockedFetch.mockResolvedValue(jsonResponse(429, {}));

    const result = await callOpenAiWebSearch("What is Acme Corp?");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.error).toContain("rate-limited");
  });

  it("returns a safe error when the response body is not valid JSON", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("unexpected token");
      },
    } as unknown as Response);

    const result = await callOpenAiWebSearch("What is Acme Corp?");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.error).toBe("OpenAI returned an unreadable response.");
  });

  it("returns a safe error on a network failure", async () => {
    mockedFetch.mockRejectedValue(new Error("network down"));

    const result = await callOpenAiWebSearch("What is Acme Corp?");

    expect(result).toEqual({
      ok: false,
      provider: "openai",
      model: "test-model",
      error: "Could not reach OpenAI.",
    });
  });

  it("returns a distinct timeout message when the request is aborted", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    mockedFetch.mockRejectedValue(abortError);

    const result = await callOpenAiWebSearch("What is Acme Corp?");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.error).toContain("Timed out after");
  });
});
