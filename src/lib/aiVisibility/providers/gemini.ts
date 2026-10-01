import { normalizeHostname } from "../domain";
import type { AiVisibilityProviderResult, AiVisibilitySource } from "./types";

/**
 * MARKO's Gemini web-grounded provider measurement — the Gemini API's
 * `generateContent` endpoint (generativelanguage.googleapis.com) with the
 * `google_search` grounding tool enabled, manually verified in Google AI
 * Studio against `gemini-3.1-flash-lite` (see MAR-21).
 *
 * Same posture as openai.ts: this measures how the Gemini API answers a
 * question when it can ground with Google Search — it is not a
 * reproduction of any consumer chat surface.
 */

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/** Same rationale as openai.ts's REQUEST_TIMEOUT_MS — search grounding can
 * take meaningfully longer than a plain completion. */
const REQUEST_TIMEOUT_MS = 45_000;

type GeminiPart = { text?: string };

type GeminiGroundingChunk = { web?: { uri?: string; title?: string } };

type GeminiGroundingSupport = {
  segment?: { startIndex?: number; endIndex?: number };
  groundingChunkIndices?: number[];
};

type GeminiGroundingMetadata = {
  groundingChunks?: GeminiGroundingChunk[];
  groundingSupports?: GeminiGroundingSupport[];
};

type GeminiCandidate = {
  content?: { parts?: GeminiPart[] };
  groundingMetadata?: GeminiGroundingMetadata;
  finishReason?: string;
};

type GeminiPayload = {
  candidates?: GeminiCandidate[];
  usageMetadata?: Record<string, unknown>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

/**
 * Safe, operator-facing diagnostics for a non-2xx Gemini response — logged
 * to the server console only, never returned to the UI or persisted. Built
 * solely from Google's *response* (status, Retry-After header, JSON error
 * body); request headers (which carry the API key) are never read. Each
 * `error.details` entry is reduced to an allowlist of known google.rpc
 * fields, and every string is additionally scrubbed of the configured API
 * key and anything shaped like a Google API key, in case Google ever echoes
 * one back in a message.
 */
export type GeminiErrorDiagnostics = {
  httpStatus: number;
  retryAfter: string | null;
  errorStatus: string | null;
  errorMessage: string | null;
  details: Record<string, unknown>[];
  /** Set only when the body wasn't a parseable Google JSON error — a
   * truncated, redacted excerpt of it (e.g. an HTML page from a proxy). */
  unparsedBodyExcerpt: string | null;
};

const UNPARSED_BODY_EXCERPT_LENGTH = 500;
const GOOGLE_API_KEY_PATTERN = /AIza[0-9A-Za-z_-]{20,}/g;
const REDACTED = "[REDACTED]";

function redactString(value: string, secrets: string[]): string {
  let result = value.replace(GOOGLE_API_KEY_PATTERN, REDACTED);
  for (const secret of secrets) {
    if (secret) result = result.split(secret).join(REDACTED);
  }
  return result;
}

function redactDeep(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") return redactString(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item, secrets)]));
  }
  return value;
}

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) picked[key] = source[key];
  }
  return picked;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item): item is Record<string, unknown> => item !== null) : [];
}

/** Reduces one google.rpc `error.details` entry to the fields useful for
 * diagnosing quota/rate-limit/configuration failures. Unknown detail types
 * keep only their `@type`, so nothing unexpected is carried through. */
function sanitizeErrorDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const type = typeof detail["@type"] === "string" ? detail["@type"] : "unknown";
  const base = { "@type": type };

  if (type.endsWith("google.rpc.QuotaFailure")) {
    return {
      ...base,
      violations: asRecordArray(detail.violations).map((violation) =>
        pick(violation, [
          "subject",
          "description",
          "quotaMetric",
          "quotaId",
          "quotaDimensions",
          "quotaValue",
          "futureQuotaValue",
        ]),
      ),
    };
  }
  if (type.endsWith("google.rpc.RetryInfo")) return { ...base, ...pick(detail, ["retryDelay"]) };
  if (type.endsWith("google.rpc.Help")) {
    return { ...base, links: asRecordArray(detail.links).map((link) => pick(link, ["description", "url"])) };
  }
  if (type.endsWith("google.rpc.ErrorInfo")) return { ...base, ...pick(detail, ["reason", "domain", "metadata"]) };
  if (type.endsWith("google.rpc.LocalizedMessage")) return { ...base, ...pick(detail, ["message"]) };
  return base;
}

/** Pure parser for a non-2xx Gemini response body — exported for tests. */
export function parseGeminiErrorDiagnostics(
  httpStatus: number,
  bodyText: string | null,
  retryAfter: string | null,
  secrets: string[],
): GeminiErrorDiagnostics {
  let error: Record<string, unknown> | null = null;
  if (bodyText) {
    try {
      error = asRecord(asRecord(JSON.parse(bodyText))?.error);
    } catch {
      error = null;
    }
  }

  const diagnostics: GeminiErrorDiagnostics = {
    httpStatus,
    retryAfter,
    errorStatus: typeof error?.status === "string" ? error.status : null,
    errorMessage: typeof error?.message === "string" ? error.message : null,
    details: asRecordArray(error?.details).map(sanitizeErrorDetail),
    // Redacted before truncating, so a key straddling the cut-off can't
    // survive as a partial prefix that no longer matches the redaction.
    unparsedBodyExcerpt:
      error === null && bodyText ? redactString(bodyText, secrets).slice(0, UNPARSED_BODY_EXCERPT_LENGTH) : null,
  };

  return redactDeep(diagnostics, secrets) as GeminiErrorDiagnostics;
}

async function readGeminiErrorDiagnostics(response: Response, apiKey: string): Promise<GeminiErrorDiagnostics> {
  let bodyText: string | null = null;
  try {
    bodyText = await response.text();
  } catch {
    bodyText = null;
  }
  const retryAfter = response.headers?.get("retry-after") ?? null;
  return parseGeminiErrorDiagnostics(response.status, bodyText, retryAfter, [apiKey]);
}

/** Google answers 429 RESOURCE_EXHAUSTED both for short-term rate limiting
 * and for "no usable quota at all" (billing inactive, prepaid credit not
 * yet available, tier not yet propagated to a new key). Only the error
 * message tells the two apart; telling a user to "try again shortly" for
 * the latter is misleading. */
function isQuotaOrBillingError(diagnostics: GeminiErrorDiagnostics): boolean {
  return /quota|billing|plan/i.test(diagnostics.errorMessage ?? "");
}

function describeGeminiApiError(diagnostics: GeminiErrorDiagnostics, model: string): string {
  const status = diagnostics.httpStatus;
  if (status === 401 || status === 403) {
    return "Gemini rejected the request — the configured API key may be invalid or revoked.";
  }
  if (status === 400) {
    return "Gemini rejected the request — the configured API key or model may be invalid.";
  }
  if (status === 404) {
    return `Gemini model "${model}" is not available to the configured API key. Check GEMINI_MODEL.`;
  }
  if (status === 429 && isQuotaOrBillingError(diagnostics)) {
    return "Gemini reported no available quota for the configured API key's project (quota exhausted, or billing/plan not active yet). Check the project's plan, billing and rate limits in Google AI Studio.";
  }
  if (status === 429) {
    return "Gemini rate-limited this request. Please try again shortly.";
  }
  if (status >= 500) {
    return "Gemini returned an unexpected server error. Please try again shortly.";
  }
  return `Gemini returned an unexpected error (HTTP ${status}).`;
}

/**
 * Normalizes Gemini's grounding metadata into MARKO's provider-agnostic
 * source shape. When `groundingSupports` is present, each support's
 * segment gives the exact answer-text offsets a chunk was cited for — the
 * same per-citation offsets openai.ts's annotations provide. Without
 * supports (grounding occurred but Gemini didn't return segment-level
 * attribution), one source per chunk is still emitted, with null offsets
 * — the source itself is real evidence either way, never fabricated.
 */
function normalizeGroundingMetadata(metadata: GeminiGroundingMetadata | undefined): AiVisibilitySource[] {
  const chunks = metadata?.groundingChunks;
  if (!chunks || chunks.length === 0) return [];

  const supports = metadata?.groundingSupports ?? [];
  if (supports.length === 0) {
    const sources: AiVisibilitySource[] = [];
    for (const chunk of chunks) {
      if (!chunk.web?.uri) continue;
      sources.push({
        url: chunk.web.uri,
        title: chunk.web.title ?? null,
        domain: normalizeHostname(chunk.web.uri),
        startIndex: null,
        endIndex: null,
      });
    }
    return sources;
  }

  const sources: AiVisibilitySource[] = [];
  for (const support of supports) {
    for (const chunkIndex of support.groundingChunkIndices ?? []) {
      const chunk = chunks[chunkIndex];
      if (!chunk?.web?.uri) continue;
      sources.push({
        url: chunk.web.uri,
        title: chunk.web.title ?? null,
        domain: normalizeHostname(chunk.web.uri),
        startIndex: typeof support.segment?.startIndex === "number" ? support.segment.startIndex : null,
        endIndex: typeof support.segment?.endIndex === "number" ? support.segment.endIndex : null,
      });
    }
  }
  return sources;
}

/** The first candidate with usable text content, its parts joined in
 * order — Gemini can split an answer across multiple text parts. Null
 * when no candidate has any text (e.g. the response was safety-blocked),
 * treated as an empty-answer failure by the caller, not silently rendered
 * as "". */
function extractAnswer(candidates: GeminiCandidate[] | undefined): { text: string; sources: AiVisibilitySource[] } | null {
  if (!candidates) return null;
  for (const candidate of candidates) {
    const parts = candidate.content?.parts;
    if (!parts) continue;
    const text = parts
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
    if (text === "") continue;
    return { text, sources: normalizeGroundingMetadata(candidate.groundingMetadata) };
  }
  return null;
}

/**
 * Executes one question against the Gemini API with the `google_search`
 * grounding tool enabled. Never throws — every failure mode (missing
 * configuration, network/timeout, non-2xx response, empty/blocked answer)
 * returns a typed `{ ok: false }` result instead, matching
 * callOpenAiWebSearch's contract so a single question's failure can never
 * crash a run of several questions (see runAiVisibility.ts).
 *
 * `model` is read from `GEMINI_MODEL` rather than hardcoded, for the same
 * reason callOpenAiWebSearch reads `OPENAI_MODEL`: an operator must supply
 * the exact model identifier they've verified (see .env.example).
 */
export async function callGeminiWebSearch(questionText: string): Promise<AiVisibilityProviderResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;

  if (!apiKey) {
    return {
      ok: false,
      provider: "gemini",
      model: model ?? "unknown",
      error: "GEMINI_API_KEY is not configured.",
    };
  }
  if (!model) {
    return {
      ok: false,
      provider: "gemini",
      model: "unknown",
      error: "GEMINI_MODEL is not configured.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: questionText }] }],
        tools: [{ google_search: {} }],
      }),
    });
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `Timed out after ${REQUEST_TIMEOUT_MS / 1000}s waiting for Gemini.`
        : "Could not reach Gemini.";
    return { ok: false, provider: "gemini", model, error: message };
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const diagnostics = await readGeminiErrorDiagnostics(response, apiKey);
    // Already sanitized/redacted (see parseGeminiErrorDiagnostics). Logged
    // and also returned, so the failed result row keeps it as evidence
    // (raw_response) — the UI only ever shows `error`.
    const loggedDiagnostics = {
      model,
      endpoint: `models/${model}:generateContent`,
      tools: ["google_search"],
      ...diagnostics,
    };
    console.error("[ai-visibility][gemini] request failed", loggedDiagnostics);
    return {
      ok: false,
      provider: "gemini",
      model,
      error: describeGeminiApiError(diagnostics, model),
      diagnostics: loggedDiagnostics,
    };
  }

  let payload: GeminiPayload;
  try {
    payload = (await response.json()) as GeminiPayload;
  } catch {
    return { ok: false, provider: "gemini", model, error: "Gemini returned an unreadable response." };
  }

  const answer = extractAnswer(payload.candidates);
  if (!answer) {
    const blockReason = payload.promptFeedback?.blockReason;
    return {
      ok: false,
      provider: "gemini",
      model,
      error: blockReason ? `Gemini blocked the response (reason: ${blockReason}).` : "Gemini returned an empty answer.",
    };
  }

  return {
    ok: true,
    provider: "gemini",
    model,
    answerText: answer.text,
    sources: answer.sources,
    usage: payload.usageMetadata ?? null,
    raw: payload,
  };
}
