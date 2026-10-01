import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./openai", () => ({ callOpenAiWebSearch: vi.fn() }));
vi.mock("./gemini", () => ({ callGeminiWebSearch: vi.fn() }));

const { callOpenAiWebSearch } = await import("./openai");
const { callGeminiWebSearch } = await import("./gemini");
const {
  callAiVisibilityProvider,
  getAiVisibilityProviderModel,
  getConfiguredAiVisibilityProvider,
  isAiVisibilityProviderConfigured,
} = await import("./select");

const mockedCallOpenAiWebSearch = vi.mocked(callOpenAiWebSearch);
const mockedCallGeminiWebSearch = vi.mocked(callGeminiWebSearch);

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("getConfiguredAiVisibilityProvider", () => {
  it("defaults to openai when AI_VISIBILITY_PROVIDER is unset — existing behavior is unchanged", () => {
    delete process.env.AI_VISIBILITY_PROVIDER;
    expect(getConfiguredAiVisibilityProvider()).toBe("openai");
  });

  it("selects gemini when AI_VISIBILITY_PROVIDER=gemini", () => {
    process.env.AI_VISIBILITY_PROVIDER = "gemini";
    expect(getConfiguredAiVisibilityProvider()).toBe("gemini");
  });

  it("falls back to openai for an unrecognized value", () => {
    process.env.AI_VISIBILITY_PROVIDER = "perplexity";
    expect(getConfiguredAiVisibilityProvider()).toBe("openai");
  });

  it("is case-insensitive", () => {
    process.env.AI_VISIBILITY_PROVIDER = "GEMINI";
    expect(getConfiguredAiVisibilityProvider()).toBe("gemini");
  });
});

describe("isAiVisibilityProviderConfigured", () => {
  it("requires OPENAI_API_KEY and OPENAI_MODEL for openai", () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
    expect(isAiVisibilityProviderConfigured("openai")).toBe(false);

    process.env.OPENAI_API_KEY = "key";
    process.env.OPENAI_MODEL = "model";
    expect(isAiVisibilityProviderConfigured("openai")).toBe(true);
  });

  it("requires GEMINI_API_KEY and GEMINI_MODEL for gemini", () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    expect(isAiVisibilityProviderConfigured("gemini")).toBe(false);

    process.env.GEMINI_API_KEY = "key";
    process.env.GEMINI_MODEL = "model";
    expect(isAiVisibilityProviderConfigured("gemini")).toBe(true);
  });
});

describe("getAiVisibilityProviderModel", () => {
  it("reads the model env var matching the selected provider", () => {
    process.env.OPENAI_MODEL = "gpt-test";
    process.env.GEMINI_MODEL = "gemini-test";
    expect(getAiVisibilityProviderModel("openai")).toBe("gpt-test");
    expect(getAiVisibilityProviderModel("gemini")).toBe("gemini-test");
  });

  it("returns 'unknown' when the model env var is unset", () => {
    delete process.env.GEMINI_MODEL;
    expect(getAiVisibilityProviderModel("gemini")).toBe("unknown");
  });
});

describe("callAiVisibilityProvider", () => {
  it("dispatches to the OpenAI adapter for 'openai' and never calls Gemini", async () => {
    mockedCallOpenAiWebSearch.mockResolvedValue({
      ok: true,
      provider: "openai",
      model: "gpt-test",
      answerText: "answer",
      sources: [],
      usage: null,
      raw: {},
    });

    const result = await callAiVisibilityProvider("openai", "What is Acme Corp?");

    expect(mockedCallOpenAiWebSearch).toHaveBeenCalledWith("What is Acme Corp?");
    expect(mockedCallGeminiWebSearch).not.toHaveBeenCalled();
    expect(result.provider).toBe("openai");
  });

  it("dispatches to the Gemini adapter for 'gemini' and never calls OpenAI", async () => {
    mockedCallGeminiWebSearch.mockResolvedValue({
      ok: true,
      provider: "gemini",
      model: "gemini-test",
      answerText: "answer",
      sources: [],
      usage: null,
      raw: {},
    });

    const result = await callAiVisibilityProvider("gemini", "What is Acme Corp?");

    expect(mockedCallGeminiWebSearch).toHaveBeenCalledWith("What is Acme Corp?");
    expect(mockedCallOpenAiWebSearch).not.toHaveBeenCalled();
    expect(result.provider).toBe("gemini");
  });
});
