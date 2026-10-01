import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { requireUserAndOrganization as RequireUserAndOrganization } from "@/lib/organizations";

vi.mock("@/lib/organizations", () => ({ requireUserAndOrganization: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/aiVisibility/runAiVisibility", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/aiVisibility/runAiVisibility")>()),
  runAiVisibility: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

const { requireUserAndOrganization } = await import("@/lib/organizations");
const { createClient } = await import("@/lib/supabase/server");
const { runAiVisibility } = await import("@/lib/aiVisibility/runAiVisibility");
const {
  createAiVisibilityQuestion,
  runApiAiVisibilityAnalysis,
  runBrowserAiVisibilityAnalysis,
  getAiVisibilityRunDetail,
} = await import("./actions");

const mockedRequireUserAndOrganization = vi.mocked(requireUserAndOrganization);
const mockedCreateClient = vi.mocked(createClient);
const mockedRunAiVisibility = vi.mocked(runAiVisibility);

type AuthResult = Awaited<ReturnType<typeof RequireUserAndOrganization>>;
const USER = { id: "user-1" } as AuthResult["user"];
const ORG = { id: "org-1", name: "Acme" };

function authed(): AuthResult {
  return { user: USER, organization: ORG };
}

type TableResponse = { data?: unknown; error?: unknown };
/** A response computed from the `.insert(values, options)` arguments. */
type InsertResponder = (values: unknown, options?: { defaultToNull?: boolean }) => TableResponse;

/** A minimal, per-table queued fake of the chained supabase-js query
 * builder (.from().select()/.insert()/.update()/.eq()/.order()/.in(),
 * resolved via .single()/.maybeSingle() or by awaiting the chain itself).
 * Each `.from(table)` call pops the next queued response for that table,
 * so a Server Action that touches the same table more than once (e.g. an
 * insert-then-update on ai_visibility_runs) can be given a distinct
 * response per call. */
type RecordedCall = { table: string; method: string; args: unknown[] };

function makeSupabaseMock(responses: Record<string, (TableResponse | InsertResponder)[]>) {
  const queues = new Map<string, (TableResponse | InsertResponder)[]>(
    Object.entries(responses).map(([table, list]) => [table, [...list]]),
  );
  const calls: RecordedCall[] = [];

  function from(table: string) {
    let resolved: TableResponse | null = null;
    let insertArgs: unknown[] = [];
    function resolve(): TableResponse {
      if (resolved) return resolved;
      const queue = queues.get(table);
      const next = queue && queue.length > 0 ? queue.shift()! : { data: null, error: null };
      resolved = typeof next === "function" ? next(insertArgs[0], insertArgs[1] as { defaultToNull?: boolean }) : next;
      return resolved;
    }
    function record(method: string, args: unknown[]) {
      calls.push({ table, method, args });
      return chain;
    }
    const chain: {
      select: (...args: unknown[]) => typeof chain;
      insert: (...args: unknown[]) => typeof chain;
      update: (...args: unknown[]) => typeof chain;
      eq: (...args: unknown[]) => typeof chain;
      order: (...args: unknown[]) => typeof chain;
      in: (...args: unknown[]) => typeof chain;
      maybeSingle: () => Promise<TableResponse>;
      single: () => Promise<TableResponse>;
      then: <T>(onFulfilled: (value: TableResponse) => T) => Promise<T>;
    } = {
      select: (...args) => record("select", args),
      insert: (...args) => {
        insertArgs = args;
        return record("insert", args);
      },
      update: (...args) => record("update", args),
      eq: (...args) => record("eq", args),
      order: (...args) => record("order", args),
      in: (...args) => record("in", args),
      maybeSingle: async () => resolve(),
      single: async () => resolve(),
      then: (onFulfilled) => Promise.resolve(resolve()).then(onFulfilled),
    };
    return chain;
  }

  return { from: vi.fn(from), calls };
}

/** Mirrors how PostgREST stores an ai_visibility_results insert: a bulk
 * (array) insert from supabase-js sends the union of every row's keys as
 * `?columns=`, and unless `defaultToNull: false` (Prefer: missing=default)
 * a row missing one of those keys gets NULL rather than the column default
 * — which `sources jsonb not null default '[]'` rejects for the whole
 * statement (0014_ai_visibility.sql). A single-object insert only lists its
 * own keys, so its omitted columns always take their defaults. */
const postgrestResultsInsert: InsertResponder = (values, options) => {
  const rows = (Array.isArray(values) ? values : [values]) as Record<string, unknown>[];
  const columns = new Set(Array.isArray(values) ? rows.flatMap((row) => Object.keys(row)) : Object.keys(rows[0]));
  const missingToNull = Array.isArray(values) && options?.defaultToNull !== false;
  for (const row of rows) {
    const sources = "sources" in row ? row.sources : columns.has("sources") && missingToNull ? null : [];
    if (sources === null) {
      return {
        data: null,
        error: {
          code: "23502",
          message: 'null value in column "sources" of relation "ai_visibility_results" violates not-null constraint',
          details: null,
          hint: null,
        },
      };
    }
  }
  return { data: null, error: null };
};

const OWNED_SITE = { id: "site-1", name: "Acme Corp", url: "https://acmecorp.com", effective_url: null, slug: "acme-corp" };

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_MODEL = "test-model";
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.AI_VISIBILITY_BROWSER_ENABLED;
});

describe("createAiVisibilityQuestion — tenant/site isolation", () => {
  it("never inserts a question for a site outside the caller's organization", async () => {
    mockedRequireUserAndOrganization.mockResolvedValue(authed());
    const supabase = makeSupabaseMock({ sites: [{ data: null, error: null }] });
    mockedCreateClient.mockResolvedValue(supabase as never);

    const formData = new FormData();
    formData.set("siteId", "site-1");
    formData.set("questionText", "Who offers the best financing?");

    await expect(createAiVisibilityQuestion(formData)).rejects.toThrow("REDIRECT:/dashboard?error=site-not-found");
    expect(supabase.from).not.toHaveBeenCalledWith("ai_visibility_questions");
  });

  it("inserts a question scoped to the site's own organization when the site is owned", async () => {
    mockedRequireUserAndOrganization.mockResolvedValue(authed());
    const supabase = makeSupabaseMock({
      sites: [{ data: OWNED_SITE, error: null }],
      ai_visibility_questions: [{ data: null, error: null }],
    });
    mockedCreateClient.mockResolvedValue(supabase as never);

    const formData = new FormData();
    formData.set("siteId", "site-1");
    formData.set("questionText", "Who offers the best financing?");
    formData.set("category", "financing");

    await expect(createAiVisibilityQuestion(formData)).rejects.toThrow(
      "REDIRECT:/dashboard/sites/acme-corp/ai-visibility",
    );
    expect(supabase.from).toHaveBeenCalledWith("ai_visibility_questions");
  });
});

describe("runApiAiVisibilityAnalysis", () => {
  it("redirects with no-active-questions and never creates a run when there are no active questions", async () => {
    mockedRequireUserAndOrganization.mockResolvedValue(authed());
    const supabase = makeSupabaseMock({
      sites: [{ data: OWNED_SITE, error: null }],
      ai_visibility_questions: [{ data: [], error: null }],
    });
    mockedCreateClient.mockResolvedValue(supabase as never);

    const formData = new FormData();
    formData.set("siteId", "site-1");

    await expect(runApiAiVisibilityAnalysis(formData)).rejects.toThrow(
      "REDIRECT:/dashboard/sites/acme-corp/ai-visibility?error=no-active-questions",
    );
    expect(supabase.from).not.toHaveBeenCalledWith("ai_visibility_runs");
    expect(mockedRunAiVisibility).not.toHaveBeenCalled();
  });

  it("records a single failed run with a safe message and never calls the provider when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    mockedRequireUserAndOrganization.mockResolvedValue(authed());
    const supabase = makeSupabaseMock({
      sites: [{ data: OWNED_SITE, error: null }],
      ai_visibility_questions: [{ data: [{ id: "q1", question_text: "Who offers financing?" }], error: null }],
      ai_visibility_runs: [{ data: null, error: null }],
    });
    mockedCreateClient.mockResolvedValue(supabase as never);

    const formData = new FormData();
    formData.set("siteId", "site-1");

    await expect(runApiAiVisibilityAnalysis(formData)).rejects.toThrow(
      "REDIRECT:/dashboard/sites/acme-corp/ai-visibility",
    );

    expect(mockedRunAiVisibility).not.toHaveBeenCalled();
    expect(supabase.from).toHaveBeenCalledWith("ai_visibility_runs");
  });

  it("persists both a completed and a failed result from the same run in one insert (partial failure)", async () => {
    mockedRequireUserAndOrganization.mockResolvedValue(authed());
    mockedRunAiVisibility.mockResolvedValue([
      {
        questionId: "q1",
        status: "completed",
        provider: "openai",
        model: "test-model",
        answerText: "Acme Corp is a strong option.",
        sources: [],
        mentioned: true,
        cited: false,
        firstMentionIndex: 0,
        usage: null,
        raw: {},
      },
      {
        questionId: "q2",
        status: "failed",
        provider: "openai",
        model: "test-model",
        errorMessage: "OpenAI rate-limited this request. Please try again shortly.",
      },
    ]);

    const supabase = makeSupabaseMock({
      sites: [{ data: OWNED_SITE, error: null }],
      ai_visibility_questions: [
        {
          data: [
            { id: "q1", question_text: "Who offers financing?" },
            { id: "q2", question_text: "Who has the best rates?" },
          ],
          error: null,
        },
      ],
      ai_visibility_runs: [{ data: { id: "run-1" }, error: null }, { data: null, error: null }],
      ai_visibility_results: [{ data: null, error: null }],
    });
    mockedCreateClient.mockResolvedValue(supabase as never);

    const formData = new FormData();
    formData.set("siteId", "site-1");

    await expect(runApiAiVisibilityAnalysis(formData)).rejects.toThrow(
      "REDIRECT:/dashboard/sites/acme-corp/ai-visibility",
    );

    const resultsInsertCall = supabase.calls.find(
      (call) => call.table === "ai_visibility_results" && call.method === "insert",
    );
    expect(resultsInsertCall?.args[0]).toEqual([
      expect.objectContaining({ question_id: "q1", status: "completed", answer_text: "Acme Corp is a strong option." }),
      expect.objectContaining({
        question_id: "q2",
        status: "failed",
        error_message: "OpenAI rate-limited this request. Please try again shortly.",
        raw_response: null,
      }),
    ]);

    const runUpdateCall = supabase.calls.find((call) => call.table === "ai_visibility_runs" && call.method === "update");
    expect(runUpdateCall?.args[0]).toEqual(
      expect.objectContaining({ status: "completed", succeeded_count: 1, failed_count: 1, error_message: null }),
    );
  });

  it("marks the run failed (not completed) when every question failed", async () => {
    mockedRequireUserAndOrganization.mockResolvedValue(authed());
    mockedRunAiVisibility.mockResolvedValue([
      {
        questionId: "q1",
        status: "failed",
        provider: "gemini",
        model: "test-model",
        errorMessage: "Gemini rate-limited this request. Please try again shortly.",
      },
    ]);

    const supabase = makeSupabaseMock({
      sites: [{ data: OWNED_SITE, error: null }],
      ai_visibility_questions: [{ data: [{ id: "q1", question_text: "Who offers financing?" }], error: null }],
      ai_visibility_runs: [{ data: { id: "run-1" }, error: null }, { data: null, error: null }],
      ai_visibility_results: [{ data: null, error: null }],
    });
    mockedCreateClient.mockResolvedValue(supabase as never);

    const formData = new FormData();
    formData.set("siteId", "site-1");

    await expect(runApiAiVisibilityAnalysis(formData)).rejects.toThrow(
      "REDIRECT:/dashboard/sites/acme-corp/ai-visibility",
    );

    const runUpdateCall = supabase.calls.find((call) => call.table === "ai_visibility_runs" && call.method === "update");
    expect(runUpdateCall?.args[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        succeeded_count: 0,
        failed_count: 1,
        error_message: "Gemini rate-limited this request. Please try again shortly.",
      }),
    );
  });
});

describe("execution method (API vs Browser)", () => {
  function completedOutcome(provider: "openai" | "gemini", model: string) {
    return {
      questionId: "q1",
      status: "completed" as const,
      provider,
      model,
      answerText: "Acme Corp is a strong option.",
      sources: [],
      mentioned: true,
      cited: false,
      firstMentionIndex: 0,
      usage: null,
      raw: {},
    };
  }

  function supabaseForOneQuestionRun() {
    return makeSupabaseMock({
      sites: [{ data: OWNED_SITE, error: null }],
      ai_visibility_questions: [{ data: [{ id: "q1", question_text: "Who offers financing?" }], error: null }],
      ai_visibility_runs: [{ data: { id: "run-1" }, error: null }, { data: null, error: null }],
      ai_visibility_results: [{ data: null, error: null }],
    });
  }

  function formDataForSite() {
    const formData = new FormData();
    formData.set("siteId", "site-1");
    return formData;
  }

  it("the API action runs only the API method and records execution_method 'api' on the run and results", async () => {
    mockedRequireUserAndOrganization.mockResolvedValue(authed());
    mockedRunAiVisibility.mockResolvedValue([completedOutcome("openai", "test-model")]);
    const supabase = supabaseForOneQuestionRun();
    mockedCreateClient.mockResolvedValue(supabase as never);

    await expect(runApiAiVisibilityAnalysis(formDataForSite())).rejects.toThrow("REDIRECT:");

    expect(mockedRunAiVisibility).toHaveBeenCalledTimes(1);
    expect(mockedRunAiVisibility.mock.calls[0][3]).toBe("api");
    const runInsert = supabase.calls.find((call) => call.table === "ai_visibility_runs" && call.method === "insert");
    expect(runInsert?.args[0]).toEqual(expect.objectContaining({ execution_method: "api", model: "test-model" }));
    const resultsInsert = supabase.calls.find((call) => call.table === "ai_visibility_results" && call.method === "insert");
    expect(resultsInsert?.args[0]).toEqual([expect.objectContaining({ execution_method: "api" })]);
    const runUpdate = supabase.calls.find((call) => call.table === "ai_visibility_runs" && call.method === "update");
    expect(runUpdate?.args[0]).not.toHaveProperty("model");
  });

  it("the Browser action runs only the browser method (Gemini, ChatGPT, Perplexity, Claude web) and records execution_method 'browser'", async () => {
    process.env.AI_VISIBILITY_BROWSER_ENABLED = "true";
    mockedRequireUserAndOrganization.mockResolvedValue(authed());
    mockedRunAiVisibility.mockResolvedValue([completedOutcome("gemini", "gemini-web (Flash-Lite)")]);
    const supabase = supabaseForOneQuestionRun();
    mockedCreateClient.mockResolvedValue(supabase as never);

    await expect(runBrowserAiVisibilityAnalysis(formDataForSite())).rejects.toThrow("REDIRECT:");

    expect(mockedRunAiVisibility).toHaveBeenCalledTimes(1);
    expect(mockedRunAiVisibility.mock.calls[0][0]).toEqual([{ id: "q1", questionText: "Who offers financing?" }]);
    expect(mockedRunAiVisibility.mock.calls[0][3]).toBe("browser");
    const runInsert = supabase.calls.find((call) => call.table === "ai_visibility_runs" && call.method === "insert");
    expect(runInsert?.args[0]).toEqual(
      expect.objectContaining({
        execution_method: "browser",
        provider: "gemini,openai,perplexity,anthropic",
        model: "gemini-web,chatgpt-web,perplexity-web,claude-web",
      }),
    );
    const resultsInsert = supabase.calls.find((call) => call.table === "ai_visibility_results" && call.method === "insert");
    expect(resultsInsert?.args[0]).toEqual([
      expect.objectContaining({ execution_method: "browser", provider: "gemini", model: "gemini-web (Flash-Lite)" }),
    ]);
    // The run picks up the web UI's detected mode label once known.
    const runUpdate = supabase.calls.find((call) => call.table === "ai_visibility_runs" && call.method === "update");
    expect(runUpdate?.args[0]).toEqual(expect.objectContaining({ status: "completed", model: "gemini-web (Flash-Lite)" }));
  });

  it("persists Gemini and ChatGPT results of one Browser run as separate provider rows, keeping a success beside a failure", async () => {
    process.env.AI_VISIBILITY_BROWSER_ENABLED = "true";
    mockedRequireUserAndOrganization.mockResolvedValue(authed());
    mockedRunAiVisibility.mockResolvedValue([
      completedOutcome("gemini", "gemini-web (Flash-Lite)"),
      { questionId: "q1", status: "failed", provider: "openai", model: "chatgpt-web", errorMessage: "ChatGPT showed a Cloudflare verification page." },
    ]);
    const supabase = supabaseForOneQuestionRun();
    mockedCreateClient.mockResolvedValue(supabase as never);

    await expect(runBrowserAiVisibilityAnalysis(formDataForSite())).rejects.toThrow("REDIRECT:");

    const resultsInsert = supabase.calls.find((call) => call.table === "ai_visibility_results" && call.method === "insert");
    expect(resultsInsert?.args[0]).toEqual([
      expect.objectContaining({ question_id: "q1", provider: "gemini", status: "completed", execution_method: "browser" }),
      expect.objectContaining({
        question_id: "q1",
        provider: "openai",
        model: "chatgpt-web",
        status: "failed",
        execution_method: "browser",
        error_message: "ChatGPT showed a Cloudflare verification page.",
      }),
    ]);
    const runUpdate = supabase.calls.find((call) => call.table === "ai_visibility_runs" && call.method === "update");
    expect(runUpdate?.args[0]).toEqual(
      expect.objectContaining({
        status: "completed",
        succeeded_count: 1,
        failed_count: 1,
        error_message: "ChatGPT: ChatGPT showed a Cloudflare verification page.",
      }),
    );
  });

  it("records a single failed browser run and never launches anything when browser mode is not enabled", async () => {
    mockedRequireUserAndOrganization.mockResolvedValue(authed());
    const supabase = makeSupabaseMock({
      sites: [{ data: OWNED_SITE, error: null }],
      ai_visibility_questions: [{ data: [{ id: "q1", question_text: "Who offers financing?" }], error: null }],
      ai_visibility_runs: [{ data: null, error: null }],
    });
    mockedCreateClient.mockResolvedValue(supabase as never);

    await expect(runBrowserAiVisibilityAnalysis(formDataForSite())).rejects.toThrow(
      "REDIRECT:/dashboard/sites/acme-corp/ai-visibility",
    );

    expect(mockedRunAiVisibility).not.toHaveBeenCalled();
    const runInsert = supabase.calls.find((call) => call.table === "ai_visibility_runs" && call.method === "insert");
    expect(runInsert?.args[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        execution_method: "browser",
        error_message: expect.stringContaining("AI_VISIBILITY_BROWSER_ENABLED"),
      }),
    );
  });

  it("never runs the browser method for a site outside the caller's organization", async () => {
    process.env.AI_VISIBILITY_BROWSER_ENABLED = "true";
    mockedRequireUserAndOrganization.mockResolvedValue(authed());
    const supabase = makeSupabaseMock({ sites: [{ data: null, error: null }] });
    mockedCreateClient.mockResolvedValue(supabase as never);

    await expect(runBrowserAiVisibilityAnalysis(formDataForSite())).rejects.toThrow(
      "REDIRECT:/dashboard?error=site-not-found",
    );
    expect(mockedRunAiVisibility).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalledWith("ai_visibility_runs");
  });
});

describe("Browser run result persistence (one question × Gemini, ChatGPT, Perplexity, Claude)", () => {
  type Provider = "gemini" | "openai" | "perplexity" | "anthropic";
  const MODELS: Record<Provider, string> = {
    gemini: "gemini-web (Flash-Lite)",
    openai: "chatgpt-web",
    perplexity: "perplexity-web",
    anthropic: "claude-web",
  };
  const PROVIDERS: Provider[] = ["gemini", "openai", "perplexity", "anthropic"];

  function succeeded(provider: Provider) {
    return {
      questionId: "q1",
      status: "completed" as const,
      provider,
      model: MODELS[provider],
      answerText: `${provider} answer naming Acme Corp.`,
      sources: [{ url: "https://example.com", title: "Example", domain: "example.com", startIndex: null, endIndex: null }],
      mentioned: true,
      cited: false,
      firstMentionIndex: 0,
      usage: null,
      raw: { answerHtml: "<p>answer</p>" },
    };
  }

  function failed(provider: Provider, errorMessage: string) {
    return { questionId: "q1", status: "failed" as const, provider, model: MODELS[provider], errorMessage };
  }

  function supabaseWithResults(...resultResponses: (TableResponse | InsertResponder)[]) {
    return makeSupabaseMock({
      sites: [{ data: OWNED_SITE, error: null }],
      ai_visibility_questions: [{ data: [{ id: "q1", question_text: "Who offers financing?" }], error: null }],
      ai_visibility_runs: [{ data: { id: "run-1" }, error: null }, { data: null, error: null }],
      ai_visibility_results: resultResponses,
    });
  }

  async function runBrowser(supabase: ReturnType<typeof makeSupabaseMock>) {
    process.env.AI_VISIBILITY_BROWSER_ENABLED = "true";
    mockedRequireUserAndOrganization.mockResolvedValue(authed());
    mockedCreateClient.mockResolvedValue(supabase as never);
    const formData = new FormData();
    formData.set("siteId", "site-1");
    await expect(runBrowserAiVisibilityAnalysis(formData)).rejects.toThrow(
      "REDIRECT:/dashboard/sites/acme-corp/ai-visibility",
    );
  }

  function resultInserts(supabase: ReturnType<typeof makeSupabaseMock>) {
    return supabase.calls.filter((call) => call.table === "ai_visibility_results" && call.method === "insert");
  }

  function runUpdate(supabase: ReturnType<typeof makeSupabaseMock>) {
    return supabase.calls.find((call) => call.table === "ai_visibility_runs" && call.method === "update")?.args[0];
  }

  it("persists all four provider results and completes the run when every provider succeeds", async () => {
    mockedRunAiVisibility.mockResolvedValue(PROVIDERS.map(succeeded));
    const supabase = supabaseWithResults(postgrestResultsInsert);

    await runBrowser(supabase);

    const inserts = resultInserts(supabase);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].args[0]).toHaveLength(4);
    expect(runUpdate(supabase)).toEqual(
      expect.objectContaining({ status: "completed", succeeded_count: 4, failed_count: 0, error_message: null }),
    );
  });

  it("regression: Gemini + ChatGPT succeed while Perplexity + Claude fail -> four rows persisted, run completed 2/2", async () => {
    mockedRunAiVisibility.mockResolvedValue([
      succeeded("gemini"),
      succeeded("openai"),
      failed("perplexity", "Perplexity requires signing in."),
      failed("anthropic", "Claude showed a Cloudflare verification page."),
    ]);
    const supabase = supabaseWithResults(postgrestResultsInsert);

    await runBrowser(supabase);

    const inserts = resultInserts(supabase);
    expect(inserts).toHaveLength(1);
    const [rows, options] = inserts[0].args as [Record<string, unknown>[], { defaultToNull?: boolean }];
    // The exact failure mechanism: failed rows omit `sources`, so the same
    // bulk insert without `defaultToNull: false` is rejected wholesale.
    expect(postgrestResultsInsert(rows).error).toEqual(expect.objectContaining({ code: "23502" }));
    expect(options).toEqual({ defaultToNull: false });
    expect(rows).toEqual([
      expect.objectContaining({ provider: "gemini", status: "completed" }),
      expect.objectContaining({ provider: "openai", status: "completed" }),
      expect.objectContaining({ provider: "perplexity", status: "failed", error_message: "Perplexity requires signing in." }),
      expect.objectContaining({
        provider: "anthropic",
        status: "failed",
        error_message: "Claude showed a Cloudflare verification page.",
      }),
    ]);
    // Failed providers carry no fabricated KPI values.
    expect(rows[2]).not.toHaveProperty("mentioned");
    expect(rows[2]).not.toHaveProperty("sources");
    expect(runUpdate(supabase)).toEqual(
      expect.objectContaining({
        status: "completed",
        succeeded_count: 2,
        failed_count: 2,
        error_message:
          "Perplexity: Perplexity requires signing in. · Claude: Claude showed a Cloudflare verification page.",
      }),
    );
  });

  it("persists every failed provider result and marks the run failed when all providers fail", async () => {
    mockedRunAiVisibility.mockResolvedValue(PROVIDERS.map((provider) => failed(provider, `${provider} blocked.`)));
    const supabase = supabaseWithResults(postgrestResultsInsert);

    await runBrowser(supabase);

    expect(resultInserts(supabase)[0].args[0]).toHaveLength(4);
    expect(runUpdate(supabase)).toEqual(
      expect.objectContaining({ status: "failed", succeeded_count: 0, failed_count: 4 }),
    );
  });

  it("when one provider result can't be stored, still persists the others and counts only persisted results", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedRunAiVisibility.mockResolvedValue([
      succeeded("gemini"),
      succeeded("openai"),
      failed("perplexity", "Perplexity requires signing in."),
      failed("anthropic", "Claude blocked."),
    ]);
    const rejected = {
      data: null,
      error: { code: "22P02", message: "invalid input syntax for type json", details: null, hint: null },
    };
    const supabase = supabaseWithResults(
      rejected, // bulk insert
      { data: null, error: null }, // gemini
      rejected, // chatgpt — its payload can't be stored
      { data: null, error: null }, // perplexity
      { data: null, error: null }, // claude
    );

    await runBrowser(supabase);

    const inserts = resultInserts(supabase);
    expect(inserts).toHaveLength(5);
    expect(inserts.slice(1).map((call) => (call.args[0] as { provider: string }[])[0].provider)).toEqual(PROVIDERS);
    // Counts match the persisted rows (Gemini completed; Perplexity, Claude failed).
    expect(runUpdate(supabase)).toEqual(
      expect.objectContaining({
        status: "completed",
        succeeded_count: 1,
        failed_count: 2,
        model: "gemini-web (Flash-Lite)",
        error_message:
          "Perplexity: Perplexity requires signing in. · Claude: Claude blocked. · 1 provider result(s) could not be saved.",
      }),
    );
    // The server log names the run, question, provider and the real error.
    expect(consoleError).toHaveBeenCalledWith(
      "[runAiVisibilityAnalysis] failed to persist provider result",
      expect.objectContaining({
        runId: "run-1",
        questionId: "q1",
        provider: "openai",
        code: "22P02",
        message: "invalid input syntax for type json",
      }),
    );
    consoleError.mockRestore();
  });

  it("marks the run failed with the saved-results message only when no provider result could be stored", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedRunAiVisibility.mockResolvedValue([succeeded("gemini"), failed("openai", "ChatGPT blocked.")]);
    const rejected = { data: null, error: { code: "XX000", message: "boom", details: null, hint: null } };
    const supabase = supabaseWithResults(rejected, rejected, rejected);

    await runBrowser(supabase);

    expect(runUpdate(supabase)).toEqual(
      expect.objectContaining({
        status: "failed",
        error_message: "The analysis completed but its results could not be saved.",
      }),
    );
    consoleError.mockRestore();
  });
});

describe("getAiVisibilityRunDetail — provider summaries", () => {
  it("returns per-provider KPIs and competitors, never the full answer, and no fake KPIs for a failed provider", async () => {
    mockedRequireUserAndOrganization.mockResolvedValue(authed());
    const supabase = makeSupabaseMock({
      ai_visibility_runs: [
        {
          data: {
            id: "run-1",
            status: "completed",
            provider: "gemini,openai",
            model: "gemini-web,chatgpt-web",
            execution_method: "browser",
            started_at: "2026-10-01T15:00:00Z",
            completed_at: "2026-10-01T15:01:00Z",
            error_message: "ChatGPT: blocked.",
            question_count: 1,
            succeeded_count: 1,
            failed_count: 1,
          },
        },
      ],
      sites: [{ data: { name: "Acme Corp", url: "https://acmecorp.com", effective_url: null } }],
      ai_visibility_results: [
        {
          data: [
            {
              id: "r-gemini",
              question_id: "q1",
              provider: "gemini",
              model: "gemini-web",
              status: "completed",
              answer_text: "A long Gemini answer.",
              sources: [{ url: "https://a.com" }, { url: "https://a.com" }, { url: "https://b.com" }],
              raw_response: {
                answerHtml:
                  "<ul><li><p><b>Globex</b> (Bogotá) – Studio.</p></li><li><p><b>Acme Corp</b> (Cali) – The client.</p></li></ul>",
              },
              mentioned: true,
              cited: false,
              error_message: null,
              created_at: "2026-10-01T15:01:00Z",
            },
            {
              id: "r-chatgpt",
              question_id: "q1",
              provider: "openai",
              model: "chatgpt-web",
              status: "failed",
              answer_text: null,
              sources: [],
              raw_response: null,
              mentioned: null,
              cited: null,
              error_message: "ChatGPT: blocked.",
              created_at: "2026-10-01T15:01:00Z",
            },
          ],
        },
      ],
      ai_visibility_questions: [{ data: [{ id: "q1", question_text: "Who?", category: null }] }],
    });
    mockedCreateClient.mockResolvedValue(supabase as never);

    const result = await getAiVisibilityRunDetail("site-1", "run-1");

    if (!result.ok) throw new Error("expected ok");
    expect(result.results).toEqual([
      expect.objectContaining({ id: "r-gemini", provider: "gemini", competitors: ["Globex"], sourceCount: 2, mentioned: true }),
      expect.objectContaining({ id: "r-chatgpt", provider: "openai", status: "failed", competitors: null, sourceCount: null }),
    ]);
    expect(JSON.stringify(result)).not.toContain("A long Gemini answer.");
  });
});

describe("getAiVisibilityRunDetail — tenant/site isolation", () => {
  it("returns a not-found error when the run does not belong to the caller's site/organization", async () => {
    mockedRequireUserAndOrganization.mockResolvedValue(authed());
    const supabase = makeSupabaseMock({ ai_visibility_runs: [{ data: null, error: null }] });
    mockedCreateClient.mockResolvedValue(supabase as never);

    const result = await getAiVisibilityRunDetail("site-1", "run-1");

    expect(result).toEqual({ ok: false, error: "That analysis could not be found." });
  });

  it("returns an error without touching the database when the caller has no organization", async () => {
    mockedRequireUserAndOrganization.mockResolvedValue({ user: USER, organization: null });

    const result = await getAiVisibilityRunDetail("site-1", "run-1");

    expect(result.ok).toBe(false);
    expect(mockedCreateClient).not.toHaveBeenCalled();
  });
});
