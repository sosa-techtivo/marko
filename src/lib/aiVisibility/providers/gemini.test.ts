import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockedFetch = vi.fn();
vi.stubGlobal("fetch", mockedFetch);

const { callGeminiWebSearch, parseGeminiErrorDiagnostics } = await import("./gemini");

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function textResponse(status: number, text: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => JSON.parse(text),
    text: async () => text,
  } as Response;
}

/** A representative Gemini API 429 body — shape per Google's google.rpc
 * error model; values are illustrative fixtures, not captured output. */
const QUOTA_ERROR_BODY = {
  error: {
    code: 429,
    message: "You exceeded your current quota, please check your plan and billing details.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [
          {
            quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
            quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
            quotaDimensions: { location: "global", model: "test-model" },
            quotaValue: "500",
          },
        ],
      },
      {
        "@type": "type.googleapis.com/google.rpc.Help",
        links: [{ description: "Learn more about Gemini API quotas", url: "https://ai.google.dev/gemini-api/docs/rate-limits" }],
      },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "37s" },
      { "@type": "type.googleapis.com/google.rpc.DebugInfo", stackEntries: ["internal"], detail: "internal" },
    ],
  },
};

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_MODEL = "test-model";
});

afterEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("callGeminiWebSearch — configuration", () => {
  it("fails safely without calling the API when GEMINI_API_KEY is missing", async () => {
    delete process.env.GEMINI_API_KEY;

    const result = await callGeminiWebSearch("What is Acme Corp?");

    expect(result).toEqual({
      ok: false,
      provider: "gemini",
      model: "test-model",
      error: "GEMINI_API_KEY is not configured.",
    });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("fails safely without calling the API when GEMINI_MODEL is missing", async () => {
    delete process.env.GEMINI_MODEL;

    const result = await callGeminiWebSearch("What is Acme Corp?");

    expect(result).toEqual({
      ok: false,
      provider: "gemini",
      model: "unknown",
      error: "GEMINI_MODEL is not configured.",
    });
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

describe("callGeminiWebSearch — request shape", () => {
  it("sends the question and google_search tool, with the API key as a header (never in the URL)", async () => {
    mockedFetch.mockResolvedValue(
      jsonResponse(200, {
        candidates: [{ content: { parts: [{ text: "An answer." }] } }],
      }),
    );

    await callGeminiWebSearch("What is Acme Corp?");

    expect(mockedFetch).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-goog-api-key": "test-key" }),
      }),
    );
    const requestBody = JSON.parse(mockedFetch.mock.calls[0][1].body);
    expect(requestBody).toEqual({
      contents: [{ parts: [{ text: "What is Acme Corp?" }] }],
      tools: [{ google_search: {} }],
    });
  });
});

describe("callGeminiWebSearch — response parsing", () => {
  it("normalizes the answer text and grounding chunks (via groundingSupports) into sources with offsets", async () => {
    mockedFetch.mockResolvedValue(
      jsonResponse(200, {
        candidates: [
          {
            content: { parts: [{ text: "Acme Corp is a leading provider." }] },
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: "https://www.acmecorp.com/about", title: "About Acme Corp" } },
                { web: { uri: "not-a-valid-url", title: "Broken" } },
              ],
              groundingSupports: [
                { segment: { startIndex: 0, endIndex: 9 }, groundingChunkIndices: [0] },
                { segment: { startIndex: 10, endIndex: 20 }, groundingChunkIndices: [1] },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 34 },
      }),
    );

    const result = await callGeminiWebSearch("What is Acme Corp?");

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
        startIndex: 10,
        endIndex: 20,
      },
    ]);
    expect(result.usage).toEqual({ promptTokenCount: 12, candidatesTokenCount: 34 });
    expect(result.model).toBe("test-model");
    expect(result.provider).toBe("gemini");
  });

  it("falls back to one source per grounding chunk, with null offsets, when groundingSupports is absent", async () => {
    mockedFetch.mockResolvedValue(
      jsonResponse(200, {
        candidates: [
          {
            content: { parts: [{ text: "Acme Corp is a leading provider." }] },
            groundingMetadata: {
              groundingChunks: [{ web: { uri: "https://acmecorp.com/about", title: "About" } }],
            },
          },
        ],
      }),
    );

    const result = await callGeminiWebSearch("What is Acme Corp?");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.sources).toEqual([
      { url: "https://acmecorp.com/about", title: "About", domain: "acmecorp.com", startIndex: null, endIndex: null },
    ]);
  });

  it("treats a response with no candidates as an empty-answer failure", async () => {
    mockedFetch.mockResolvedValue(jsonResponse(200, { candidates: [] }));

    const result = await callGeminiWebSearch("What is Acme Corp?");

    expect(result).toEqual({
      ok: false,
      provider: "gemini",
      model: "test-model",
      error: "Gemini returned an empty answer.",
    });
  });

  it("treats a blank text part as an empty-answer failure", async () => {
    mockedFetch.mockResolvedValue(jsonResponse(200, { candidates: [{ content: { parts: [{ text: "   " }] } }] }));

    const result = await callGeminiWebSearch("What is Acme Corp?");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.error).toBe("Gemini returned an empty answer.");
  });

  it("surfaces a safety-block reason when the prompt was blocked", async () => {
    mockedFetch.mockResolvedValue(
      jsonResponse(200, { candidates: [], promptFeedback: { blockReason: "SAFETY" } }),
    );

    const result = await callGeminiWebSearch("What is Acme Corp?");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.error).toBe("Gemini blocked the response (reason: SAFETY).");
  });

  it("maps a 403 response to a safe, non-raw error message", async () => {
    mockedFetch.mockResolvedValue(jsonResponse(403, { error: { message: "API key not valid: AIzaSy-abc123" } }));

    const result = await callGeminiWebSearch("What is Acme Corp?");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.error).not.toContain("AIzaSy-abc123");
    expect(result.error).toContain("invalid or revoked");
  });

  it("maps a 429 response to a rate-limit message", async () => {
    mockedFetch.mockResolvedValue(jsonResponse(429, {}));

    const result = await callGeminiWebSearch("What is Acme Corp?");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.error).toContain("rate-limited");
  });

  it("maps a 429 quota/billing RESOURCE_EXHAUSTED to a quota message, not 'try again shortly'", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockedFetch.mockResolvedValue(jsonResponse(429, QUOTA_ERROR_BODY));

    const result = await callGeminiWebSearch("What is Acme Corp?");

    if (result.ok) throw new Error("expected failure result");
    expect(result.error).toContain("no available quota");
    expect(result.error).not.toContain("try again shortly");
  });

  it("maps a 404 response to a model-availability message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockedFetch.mockResolvedValue(
      jsonResponse(404, { error: { code: 404, status: "NOT_FOUND", message: "This model is no longer available to new users." } }),
    );

    const result = await callGeminiWebSearch("What is Acme Corp?");

    if (result.ok) throw new Error("expected failure result");
    expect(result.error).toBe('Gemini model "test-model" is not available to the configured API key. Check GEMINI_MODEL.');
    expect(result.diagnostics).toEqual(expect.objectContaining({ httpStatus: 404, errorStatus: "NOT_FOUND" }));
  });

  it("returns a safe error when the response body is not valid JSON", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("unexpected token");
      },
    } as unknown as Response);

    const result = await callGeminiWebSearch("What is Acme Corp?");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.error).toBe("Gemini returned an unreadable response.");
  });

  it("returns a safe error on a network failure", async () => {
    mockedFetch.mockRejectedValue(new Error("network down"));

    const result = await callGeminiWebSearch("What is Acme Corp?");

    expect(result).toEqual({
      ok: false,
      provider: "gemini",
      model: "test-model",
      error: "Could not reach Gemini.",
    });
  });

  it("returns a distinct timeout message when the request is aborted", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    mockedFetch.mockRejectedValue(abortError);

    const result = await callGeminiWebSearch("What is Acme Corp?");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.error).toContain("Timed out after");
  });
});

describe("callGeminiWebSearch — non-2xx error diagnostics", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  function loggedDiagnostics() {
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const [prefix, payload] = consoleErrorSpy.mock.calls[0];
    expect(prefix).toBe("[ai-visibility][gemini] request failed");
    return payload as Record<string, unknown>;
  }

  it("parses the JSON error payload and logs quota, retry, and help details while keeping the safe user message", async () => {
    mockedFetch.mockResolvedValue(jsonResponse(429, QUOTA_ERROR_BODY, { "Retry-After": "37" }));

    const result = await callGeminiWebSearch("What is Acme Corp?");

    const logged = loggedDiagnostics();
    expect(result).toEqual({
      ok: false,
      provider: "gemini",
      model: "test-model",
      error:
        "Gemini reported no available quota for the configured API key's project (quota exhausted, or billing/plan not active yet). Check the project's plan, billing and rate limits in Google AI Studio.",
      // The same sanitized diagnostics are returned for persistence.
      diagnostics: logged,
    });
    expect(logged).toEqual({
      model: "test-model",
      endpoint: "models/test-model:generateContent",
      tools: ["google_search"],
      httpStatus: 429,
      retryAfter: "37",
      errorStatus: "RESOURCE_EXHAUSTED",
      errorMessage: "You exceeded your current quota, please check your plan and billing details.",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.QuotaFailure",
          violations: [
            {
              quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
              quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
              quotaDimensions: { location: "global", model: "test-model" },
              quotaValue: "500",
            },
          ],
        },
        {
          "@type": "type.googleapis.com/google.rpc.Help",
          links: [
            { description: "Learn more about Gemini API quotas", url: "https://ai.google.dev/gemini-api/docs/rate-limits" },
          ],
        },
        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "37s" },
        // Unknown detail types keep only their @type.
        { "@type": "type.googleapis.com/google.rpc.DebugInfo" },
      ],
      unparsedBodyExcerpt: null,
    });
  });

  it("records a null retryAfter when the header is absent", async () => {
    mockedFetch.mockResolvedValue(jsonResponse(429, QUOTA_ERROR_BODY));

    await callGeminiWebSearch("What is Acme Corp?");

    expect(loggedDiagnostics().retryAfter).toBeNull();
  });

  it("still returns a safe provider failure for a malformed/non-JSON error body", async () => {
    mockedFetch.mockResolvedValue(textResponse(503, "<html>Service Unavailable</html>"));

    const result = await callGeminiWebSearch("What is Acme Corp?");

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        provider: "gemini",
        model: "test-model",
        error: "Gemini returned an unexpected server error. Please try again shortly.",
      }),
    );
    expect(loggedDiagnostics()).toEqual(
      expect.objectContaining({
        httpStatus: 503,
        errorStatus: null,
        errorMessage: null,
        details: [],
        unparsedBodyExcerpt: "<html>Service Unavailable</html>",
      }),
    );
  });

  it("still returns a safe provider failure when the error body cannot be read at all", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers(),
      text: async () => {
        throw new Error("stream error");
      },
    } as unknown as Response);

    const result = await callGeminiWebSearch("What is Acme Corp?");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure result");
    expect(result.error).toContain("rate-limited");
    expect(loggedDiagnostics()).toEqual(expect.objectContaining({ httpStatus: 429, unparsedBodyExcerpt: null }));
  });

  it("never includes the configured API key or any Google-API-key-shaped value in diagnostics", async () => {
    const configuredKey = "AIzaSyTESTKEY_configured_0123456789abcdef";
    const otherKey = "AIzaSyOTHERKEY_echoed_back_0123456789ab";
    process.env.GEMINI_API_KEY = configuredKey;
    mockedFetch.mockResolvedValue(
      jsonResponse(400, {
        error: {
          status: "INVALID_ARGUMENT",
          message: `API key not valid: ${configuredKey} (also saw ${otherKey})`,
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason: "API_KEY_INVALID",
              domain: "googleapis.com",
              metadata: { key: configuredKey },
            },
          ],
        },
      }),
    );

    const result = await callGeminiWebSearch("What is Acme Corp?");

    const serialized = JSON.stringify(loggedDiagnostics()) + JSON.stringify(result);
    expect(serialized).not.toContain(configuredKey);
    expect(serialized).not.toContain(otherKey);
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain("API_KEY_INVALID");
  });

  it("does not log anything for a successful call", async () => {
    mockedFetch.mockResolvedValue(jsonResponse(200, { candidates: [{ content: { parts: [{ text: "An answer." }] } }] }));

    await callGeminiWebSearch("What is Acme Corp?");

    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});

describe("parseGeminiErrorDiagnostics", () => {
  it("redacts the given secrets and truncates an unparsed body excerpt", () => {
    const diagnostics = parseGeminiErrorDiagnostics(502, `secret-value ${"x".repeat(1000)}`, null, ["secret-value"]);

    expect(diagnostics.unparsedBodyExcerpt?.startsWith("[REDACTED] ")).toBe(true);
    expect(diagnostics.unparsedBodyExcerpt?.length).toBe(500);
  });

  it("redacts a key that straddles the excerpt cut-off", () => {
    const key = "AIzaSyBOUNDARY_0123456789abcdefghijkl";
    const diagnostics = parseGeminiErrorDiagnostics(502, `${"x".repeat(490)}${key}`, null, []);

    expect(diagnostics.unparsedBodyExcerpt).not.toContain("AIzaSy");
  });
});
