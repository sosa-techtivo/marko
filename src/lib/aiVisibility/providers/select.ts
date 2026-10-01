import { callGeminiWebSearch } from "./gemini";
import { callOpenAiWebSearch } from "./openai";
import type { AiVisibilityProviderId, AiVisibilityProviderResult } from "./types";

/**
 * Which AI Visibility provider a run executes against — a single
 * server-side env var, not a UI or per-run choice. MAR-21 only needs
 * Gemini to become the live provider; multi-provider execution/comparison
 * is explicitly out of scope (see CLAUDE.md's Scope Rule). Defaults to
 * "openai" so existing behavior is unchanged unless an operator opts in.
 */
export function getConfiguredAiVisibilityProvider(): AiVisibilityProviderId {
  return process.env.AI_VISIBILITY_PROVIDER?.trim().toLowerCase() === "gemini" ? "gemini" : "openai";
}

export function isAiVisibilityProviderConfigured(providerId: AiVisibilityProviderId): boolean {
  if (providerId === "gemini") return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL);
  return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL);
}

export function getAiVisibilityProviderModel(providerId: AiVisibilityProviderId): string {
  const model = providerId === "gemini" ? process.env.GEMINI_MODEL : process.env.OPENAI_MODEL;
  return model ?? "unknown";
}

export function callAiVisibilityProvider(
  providerId: AiVisibilityProviderId,
  questionText: string,
): Promise<AiVisibilityProviderResult> {
  return providerId === "gemini" ? callGeminiWebSearch(questionText) : callOpenAiWebSearch(questionText);
}
