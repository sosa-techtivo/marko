import { callAiVisibilityProvider, getConfiguredAiVisibilityProvider } from "./providers/select";
import {
  GEMINI_WEB_MODEL,
  openGeminiBrowserSession,
  releaseGeminiBrowserLock,
  tryAcquireGeminiBrowserLock,
} from "./providers/geminiBrowser";
import { CHATGPT_WEB_MODEL, openChatGptBrowserSession } from "./providers/chatgptBrowser";
import { PERPLEXITY_WEB_MODEL, openPerplexityBrowserSession } from "./providers/perplexityBrowser";
import { CLAUDE_WEB_MODEL, openClaudeBrowserSession } from "./providers/claudeBrowser";
import { aiVisibilityProviderLabel } from "./providerLabels";
import { computeCited, computeFirstMentionIndex, computeMentioned } from "./metrics";
import type {
  AiVisibilityExecutionMethod,
  AiVisibilityProviderId,
  AiVisibilityProviderResult,
  AiVisibilitySource,
} from "./providers/types";

/**
 * How many questions are executed concurrently against the provider. Kept
 * deliberately small and conservative — this is a paid external API, and
 * this slice's volume is deliberately limited to ~5–10 questions (see
 * CLAUDE.md's AI Visibility Delivery 1A scope) — not the future
 * 75-question×providers×competitors workload, which belongs to later
 * delivery work. Same batching shape as runCrawl.ts's FETCH_CONCURRENCY.
 */
const EXECUTION_CONCURRENCY = 3;

export type AiVisibilityQuestionInput = {
  id: string;
  questionText: string;
};

export type AiVisibilityQuestionOutcome =
  | {
      questionId: string;
      status: "completed";
      provider: AiVisibilityProviderResult["provider"];
      model: string;
      answerText: string;
      sources: AiVisibilitySource[];
      mentioned: boolean | null;
      cited: boolean | null;
      firstMentionIndex: number | null;
      usage: Record<string, unknown> | null;
      raw: unknown;
    }
  | {
      questionId: string;
      status: "failed";
      provider: AiVisibilityProviderResult["provider"];
      model: string;
      errorMessage: string;
      /** The provider's sanitized failure diagnostics, when it supplied any. */
      raw?: unknown;
    };

function toOutcome(
  questionId: string,
  result: AiVisibilityProviderResult,
  siteUrl: string,
  brandName: string,
): AiVisibilityQuestionOutcome {
  if (!result.ok) {
    return {
      questionId,
      status: "failed",
      provider: result.provider,
      model: result.model,
      errorMessage: result.error,
      ...(result.diagnostics ? { raw: result.diagnostics } : {}),
    };
  }

  return {
    questionId,
    status: "completed",
    provider: result.provider,
    model: result.model,
    answerText: result.answerText,
    sources: result.sources,
    mentioned: computeMentioned(result.answerText, brandName),
    cited: computeCited(result.sources, siteUrl),
    firstMentionIndex: computeFirstMentionIndex(result.answerText, brandName),
    usage: result.usage,
    raw: result.raw,
  };
}

/**
 * Executes every given question through the chosen acquisition method and
 * returns one outcome per question, in the same order they were given —
 * regardless of individual failures. A single question failing (missing
 * config, provider error, timeout, empty answer) never throws and never
 * prevents the remaining questions in the batch/run from executing or
 * being reported — see CLAUDE.md's Error Handling requirement ("do not
 * lose successful question results because another question fails").
 *
 *   - "api"     — the configured provider's API (OpenAI or Gemini — see
 *                 providers/select.ts), batched at EXECUTION_CONCURRENCY.
 *   - "browser" — the consumer web apps via real browser automation:
 *                 Gemini web (providers/geminiBrowser.ts), ChatGPT web
 *                 (providers/chatgptBrowser.ts), Perplexity web
 *                 (providers/perplexityBrowser.ts) and Claude web
 *                 (providers/claudeBrowser.ts). One outcome per question
 *                 per provider.
 *
 * Every path sends the same question text and feeds the same toOutcome
 * metrics, so only the acquisition method/provider differs.
 *
 * Pure orchestration only — no database access. The caller (the AI
 * Visibility Server Actions) is responsible for persisting the run and
 * each outcome.
 */
export async function runAiVisibility(
  questions: AiVisibilityQuestionInput[],
  siteUrl: string,
  brandName: string,
  executionMethod: AiVisibilityExecutionMethod = "api",
): Promise<AiVisibilityQuestionOutcome[]> {
  if (questions.length === 0) return [];
  if (executionMethod === "browser") return runViaBrowser(questions, siteUrl, brandName);

  const outcomes: AiVisibilityQuestionOutcome[] = [];
  const providerId = getConfiguredAiVisibilityProvider();

  for (let i = 0; i < questions.length; i += EXECUTION_CONCURRENCY) {
    const batch = questions.slice(i, i + EXECUTION_CONCURRENCY);
    const batchOutcomes = await Promise.all(
      batch.map(async (question) => {
        const result = await callAiVisibilityProvider(providerId, question.questionText);
        return toOutcome(question.id, result, siteUrl, brandName);
      }),
    );
    outcomes.push(...batchOutcomes);
  }

  return outcomes;
}

type BrowserProviderSession = {
  ask: (questionText: string) => Promise<AiVisibilityProviderResult>;
  close: () => Promise<void>;
};

type BrowserProvider = {
  provider: AiVisibilityProviderId;
  model: string;
  open: () => Promise<{ ok: true; session: BrowserProviderSession } | { ok: false; error: string }>;
};

/** The consumer web apps a Browser run asks, in result order. */
const BROWSER_PROVIDERS: BrowserProvider[] = [
  { provider: "gemini", model: GEMINI_WEB_MODEL, open: openGeminiBrowserSession },
  { provider: "openai", model: CHATGPT_WEB_MODEL, open: openChatGptBrowserSession },
  { provider: "perplexity", model: PERPLEXITY_WEB_MODEL, open: openPerplexityBrowserSession },
  { provider: "anthropic", model: CLAUDE_WEB_MODEL, open: openClaudeBrowserSession },
];

function failedOutcome(questionId: string, browserProvider: BrowserProvider, errorMessage: string): AiVisibilityQuestionOutcome {
  return {
    questionId,
    status: "failed",
    provider: browserProvider.provider,
    model: browserProvider.model,
    errorMessage,
  };
}

/**
 * One browser per provider for the whole run. Questions are asked one at a
 * time; for each question the providers are asked in parallel (separate
 * browsers on separate sites — no shared state), so a run takes about as
 * long as its slowest provider rather than the sum. A provider that can't
 * launch, or a question that fails on one provider, only fails that
 * provider's outcomes — the other provider's results are always kept.
 */
async function runViaBrowser(
  questions: AiVisibilityQuestionInput[],
  siteUrl: string,
  brandName: string,
): Promise<AiVisibilityQuestionOutcome[]> {
  if (!tryAcquireGeminiBrowserLock()) {
    const busy = "Another Browser AI Visibility analysis is already running on this server. Try again once it finishes.";
    return questions.flatMap((question) => BROWSER_PROVIDERS.map((p) => failedOutcome(question.id, p, busy)));
  }

  try {
    const opened = await Promise.all(BROWSER_PROVIDERS.map((browserProvider) => browserProvider.open()));
    try {
      const outcomes: AiVisibilityQuestionOutcome[] = [];
      for (const question of questions) {
        const questionOutcomes = await Promise.all(
          BROWSER_PROVIDERS.map(async (browserProvider, index) => {
            const session = opened[index];
            if (!session.ok) return failedOutcome(question.id, browserProvider, session.error);
            const result = await session.session.ask(question.questionText);
            return toOutcome(question.id, result, siteUrl, brandName);
          }),
        );
        outcomes.push(...questionOutcomes);
      }
      return outcomes;
    } finally {
      await Promise.all(opened.map((session) => (session.ok ? session.session.close() : undefined)));
    }
  } finally {
    releaseGeminiBrowserLock();
  }
}

export type AiVisibilityRunCompletion = {
  status: "completed" | "failed";
  succeededCount: number;
  failedCount: number;
  errorMessage: string | null;
};

/** For a multi-provider (Browser) run: one line per provider whose every
 * outcome failed, e.g. "ChatGPT: <shared message>". Empty when each provider
 * succeeded at least once. */
function describeProviderWideFailures(outcomes: AiVisibilityQuestionOutcome[]): string[] {
  const providers = [...new Set(outcomes.map((outcome) => outcome.provider))];
  const lines: string[] = [];
  for (const provider of providers) {
    const providerOutcomes = outcomes.filter((outcome) => outcome.provider === provider);
    const failures = providerOutcomes.flatMap((outcome) => (outcome.status === "failed" ? [outcome] : []));
    if (failures.length === 0 || failures.length < providerOutcomes.length) continue;
    const distinctMessages = new Set(failures.map((failure) => failure.errorMessage));
    const reason =
      distinctMessages.size === 1 ? [...distinctMessages][0] : `all ${failures.length} questions failed.`;
    lines.push(`${aiVisibilityProviderLabel(provider, "browser")}: ${reason}`);
  }
  return lines;
}

/**
 * The final run status for a set of question outcomes. The persisted run
 * status only supports 'running' | 'completed' | 'failed' (see
 * 0014_ai_visibility.sql) — there is no partial status — so:
 *   - every question succeeded → completed
 *   - every question failed    → failed
 *   - a mix                    → completed (the succeeded/failed counts
 *     carry the partial-failure signal)
 * An all-failed run gets a user-safe run-level message: the shared
 * per-question message when every failure says the same thing (e.g. the
 * provider's rate-limit message), otherwise a generic count. A
 * multi-provider (Browser) run counts provider results, and its message
 * names each provider that failed every question.
 */
export function resolveAiVisibilityRunCompletion(outcomes: AiVisibilityQuestionOutcome[]): AiVisibilityRunCompletion {
  const failures = outcomes.filter((outcome) => outcome.status === "failed");
  const failedCount = failures.length;
  const succeededCount = outcomes.length - failedCount;

  // Browser runs ask several providers per question: a provider that failed
  // every question is named in the run message even when the other
  // provider succeeded, so a partial run never reads as a clean one.
  if (new Set(outcomes.map((outcome) => outcome.provider)).size > 1) {
    const providerFailures = describeProviderWideFailures(outcomes);
    return {
      status: succeededCount > 0 ? "completed" : "failed",
      succeededCount,
      failedCount,
      errorMessage: providerFailures.length > 0 ? providerFailures.join(" · ") : null,
    };
  }

  if (failedCount === 0 || succeededCount > 0) {
    return { status: "completed", succeededCount, failedCount, errorMessage: null };
  }

  const distinctMessages = new Set(failures.map((failure) => failure.errorMessage));
  const errorMessage =
    distinctMessages.size === 1
      ? [...distinctMessages][0]
      : `All ${failedCount} questions failed. See the individual question results for details.`;

  return { status: "failed", succeededCount, failedCount, errorMessage };
}
