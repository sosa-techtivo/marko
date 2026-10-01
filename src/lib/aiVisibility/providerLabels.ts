/**
 * Display name for a result's provider. Browser results are named after the
 * consumer product that was automated (Gemini web, ChatGPT web); API
 * results after the API provider. Shared by the server (run-level messages)
 * and the UI, so both always name a provider the same way.
 */
export function aiVisibilityProviderLabel(provider: string, executionMethod: string): string {
  if (provider === "gemini") return "Gemini";
  if (provider === "openai") return executionMethod === "browser" ? "ChatGPT" : "OpenAI";
  if (provider === "perplexity") return "Perplexity";
  if (provider === "anthropic") return executionMethod === "browser" ? "Claude" : "Anthropic";
  return provider;
}
