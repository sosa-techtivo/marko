import { aiVisibilityProviderLabel } from "./providerLabels";

/** Result display order within a question: Gemini, ChatGPT/OpenAI, Perplexity, Claude. */
const PROVIDER_ORDER = ["gemini", "openai", "perplexity", "anthropic"];

function providerRank(provider: string): number {
  const index = PROVIDER_ORDER.indexOf(provider);
  return index === -1 ? PROVIDER_ORDER.length : index;
}

/**
 * Groups a run's result rows by question — preserving the order in which
 * questions first appear — with each question's provider results in a
 * fixed provider order. A Browser run has one row per question per
 * provider; an API run has one row per question.
 */
export function groupResultsByQuestion<T extends { questionId: string; provider: string }>(
  results: T[],
): { questionId: string; results: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const result of results) {
    const group = groups.get(result.questionId);
    if (group) group.push(result);
    else groups.set(result.questionId, [result]);
  }
  return [...groups.entries()].map(([questionId, group]) => ({
    questionId,
    results: [...group].sort((a, b) => providerRank(a.provider) - providerRank(b.provider)),
  }));
}

export type ProviderRunSummary = { provider: string; label: string; succeeded: number; total: number };

/** Per-provider succeeded/total counts for a run's results, in provider
 * order — so a Browser run shows e.g. "Gemini 1/1 · ChatGPT 0/1" rather than
 * one blended count that hides which provider failed. */
export function summarizeResultsByProvider(
  results: { provider: string; status: string }[],
  executionMethod: string,
): ProviderRunSummary[] {
  const byProvider = new Map<string, ProviderRunSummary>();
  for (const result of results) {
    const summary = byProvider.get(result.provider) ?? {
      provider: result.provider,
      label: aiVisibilityProviderLabel(result.provider, executionMethod),
      succeeded: 0,
      total: 0,
    };
    summary.total += 1;
    if (result.status === "completed") summary.succeeded += 1;
    byProvider.set(result.provider, summary);
  }
  return [...byProvider.values()].sort((a, b) => providerRank(a.provider) - providerRank(b.provider));
}

export function formatProviderSummaries(summaries: ProviderRunSummary[]): string {
  return summaries.map((summary) => `${summary.label} ${summary.succeeded}/${summary.total}`).join(" · ");
}
