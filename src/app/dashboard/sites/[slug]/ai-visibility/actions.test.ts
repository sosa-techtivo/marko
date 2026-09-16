import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { requireUserAndOrganization as RequireUserAndOrganization } from "@/lib/organizations";

vi.mock("@/lib/organizations", () => ({ requireUserAndOrganization: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/aiVisibility/runAiVisibility", () => ({ runAiVisibility: vi.fn() }));
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
  runAiVisibilityAnalysis,
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

/** A minimal, per-table queued fake of the chained supabase-js query
 * builder (.from().select()/.insert()/.update()/.eq()/.order()/.in(),
 * resolved via .single()/.maybeSingle() or by awaiting the chain itself).
 * Each `.from(table)` call pops the next queued response for that table,
 * so a Server Action that touches the same table more than once (e.g. an
 * insert-then-update on ai_visibility_runs) can be given a distinct
 * response per call. */
type RecordedCall = { table: string; method: string; args: unknown[] };

function makeSupabaseMock(responses: Record<string, TableResponse[]>) {
  const queues = new Map<string, TableResponse[]>(
    Object.entries(responses).map(([table, list]) => [table, [...list]]),
  );
  const calls: RecordedCall[] = [];

  function from(table: string) {
    let resolved: TableResponse | null = null;
    function resolve(): TableResponse {
      if (resolved) return resolved;
      const queue = queues.get(table);
      resolved = queue && queue.length > 0 ? queue.shift()! : { data: null, error: null };
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
      insert: (...args) => record("insert", args),
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

const OWNED_SITE = { id: "site-1", name: "Acme Corp", url: "https://acmecorp.com", effective_url: null, slug: "acme-corp" };

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_MODEL = "test-model";
});

afterEach(() => {
  vi.clearAllMocks();
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

describe("runAiVisibilityAnalysis", () => {
  it("redirects with no-active-questions and never creates a run when there are no active questions", async () => {
    mockedRequireUserAndOrganization.mockResolvedValue(authed());
    const supabase = makeSupabaseMock({
      sites: [{ data: OWNED_SITE, error: null }],
      ai_visibility_questions: [{ data: [], error: null }],
    });
    mockedCreateClient.mockResolvedValue(supabase as never);

    const formData = new FormData();
    formData.set("siteId", "site-1");

    await expect(runAiVisibilityAnalysis(formData)).rejects.toThrow(
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

    await expect(runAiVisibilityAnalysis(formData)).rejects.toThrow(
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

    await expect(runAiVisibilityAnalysis(formData)).rejects.toThrow(
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
      }),
    ]);
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
