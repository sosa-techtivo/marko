/**
 * The normalized shape every AI Visibility provider call must produce,
 * regardless of the underlying provider's own response format. Everything
 * outside src/lib/aiVisibility/providers/ (metrics, persistence, UI)
 * consumes only this — never a provider-specific response object — so a
 * later task can add Gemini/Perplexity providers without touching the
 * domain model. Deliberately small: it normalizes only what this feature
 * actually needs (see CLAUDE.md's Scope Rule), not a general-purpose LLM
 * response abstraction.
 */

export type AiVisibilitySource = {
  url: string;
  title: string | null;
  /** Lowercased hostname, "www."-stripped — see metrics.ts's
   * normalizeHostname. Null when `url` itself couldn't be parsed. */
  domain: string | null;
  /** Character offsets into the answer text this citation annotates, when
   * the provider supplies them. Null when not available. */
  startIndex: number | null;
  endIndex: number | null;
};

export type AiVisibilityProviderId = "openai" | "gemini" | "perplexity" | "anthropic";

/** How a provider's answer was acquired — the provider's programmatic API,
 * or real browser automation of its consumer web experience. Persisted as
 * `execution_method` on runs/results (0015_ai_visibility_execution_method.sql). */
export type AiVisibilityExecutionMethod = "api" | "browser";

export type AiVisibilityProviderSuccess = {
  ok: true;
  provider: AiVisibilityProviderId;
  model: string;
  answerText: string;
  sources: AiVisibilitySource[];
  /** Raw, provider-specific usage metadata (token counts, etc.), passed
   * through as-is for future cost analysis — never parsed into a dollar
   * amount here (CLAUDE.md: "Do not hardcode pricing"). Null when the
   * provider response didn't include any. */
  usage: Record<string, unknown> | null;
  /** The full raw provider response, for audit/debugging evidence only —
   * never consumed by domain logic (metrics.ts) or the UI's normal
   * rendering path. */
  raw: unknown;
};

export type AiVisibilityProviderFailure = {
  ok: false;
  provider: AiVisibilityProviderId;
  model: string;
  /** Safe to show a user — never a raw provider error body, which could
   * echo back request/account details (same posture as
   * googleSearchConsole/client.ts's describeGoogleApiError). */
  error: string;
  /** Sanitized, secret-free provider error details (HTTP status, Google
   * error status/message, quota/retry details) for development evidence —
   * persisted as the failed result's raw_response, never shown in the UI. */
  diagnostics?: Record<string, unknown>;
};

export type AiVisibilityProviderResult = AiVisibilityProviderSuccess | AiVisibilityProviderFailure;
