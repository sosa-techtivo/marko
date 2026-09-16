import { callOpenAiWebSearch } from "./providers/openai";
import { computeCited, computeFirstMentionIndex, computeMentioned } from "./metrics";
import type { AiVisibilityProviderResult, AiVisibilitySource } from "./providers/types";

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
 * Executes every given question against the configured provider (OpenAI
 * only in this slice) and returns one outcome per question, in the same
 * order they were given — regardless of individual failures. A single
 * question failing (missing config, provider error, timeout, empty
 * answer) never throws and never prevents the remaining questions in the
 * batch/run from executing or being reported — see CLAUDE.md's Error
 * Handling requirement ("do not lose successful question results because
 * another question fails").
 *
 * Pure orchestration only — no database access. The caller (the "Run AI
 * Visibility analysis" Server Action) is responsible for persisting the
 * run and each outcome.
 */
export async function runAiVisibility(
  questions: AiVisibilityQuestionInput[],
  siteUrl: string,
  brandName: string,
): Promise<AiVisibilityQuestionOutcome[]> {
  const outcomes: AiVisibilityQuestionOutcome[] = [];

  for (let i = 0; i < questions.length; i += EXECUTION_CONCURRENCY) {
    const batch = questions.slice(i, i + EXECUTION_CONCURRENCY);
    const batchOutcomes = await Promise.all(
      batch.map(async (question) => {
        const result = await callOpenAiWebSearch(question.questionText);
        return toOutcome(question.id, result, siteUrl, brandName);
      }),
    );
    outcomes.push(...batchOutcomes);
  }

  return outcomes;
}
