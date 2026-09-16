import { normalizeHostname } from "../domain";
import type { AiVisibilityProviderResult, AiVisibilitySource } from "./types";

/**
 * MARKO's OpenAI web-grounded provider measurement — the Responses API
 * (https://api.openai.com/v1/responses) with the `web_search` tool
 * enabled, confirmed against OpenAI's current official documentation at
 * implementation time (developers.openai.com/api/docs/guides/tools-web-search,
 * .../api-reference/responses/create, .../guides/text).
 *
 * This measures how OpenAI's API responds to a question when it can search
 * the live web — it is NOT a reproduction of a chatgpt.com consumer
 * session (different product surface, different default behavior/tools),
 * and nothing in this module or its callers should claim otherwise.
 */

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

/** Web search (multiple tool calls/page opens) can take meaningfully
 * longer than a plain completion — generous relative to fetchPage.ts's 8s
 * page-fetch timeout, which has no equivalent "the model is still
 * searching" latency to account for. */
const REQUEST_TIMEOUT_MS = 45_000;

type ResponsesApiAnnotation = {
  type?: string;
  url?: string;
  title?: string;
  start_index?: number;
  end_index?: number;
};

type ResponsesApiOutputItem = {
  type?: string;
  content?: { type?: string; text?: string; annotations?: ResponsesApiAnnotation[] }[];
};

type ResponsesApiPayload = {
  output?: ResponsesApiOutputItem[];
  usage?: Record<string, unknown>;
  error?: { message?: string };
};

function describeOpenAiApiError(status: number): string {
  if (status === 401) {
    return "OpenAI rejected the request — the configured API key may be invalid or revoked.";
  }
  if (status === 429) {
    return "OpenAI rate-limited this request. Please try again shortly.";
  }
  if (status >= 500) {
    return "OpenAI returned an unexpected server error. Please try again shortly.";
  }
  return `OpenAI returned an unexpected error (HTTP ${status}).`;
}

/** Normalizes one url_citation annotation into MARKO's provider-agnostic
 * source shape. Skips any annotation that isn't a url_citation (the
 * Responses API can return other annotation types this feature doesn't
 * use) or that has no usable URL at all. */
function normalizeAnnotations(annotations: ResponsesApiAnnotation[] | undefined): AiVisibilitySource[] {
  if (!annotations) return [];
  const sources: AiVisibilitySource[] = [];
  for (const annotation of annotations) {
    if (annotation.type !== "url_citation" || !annotation.url) continue;
    sources.push({
      url: annotation.url,
      title: annotation.title ?? null,
      domain: normalizeHostname(annotation.url),
      startIndex: typeof annotation.start_index === "number" ? annotation.start_index : null,
      endIndex: typeof annotation.end_index === "number" ? annotation.end_index : null,
    });
  }
  return sources;
}

/** The first "message" output item's first "output_text" content block —
 * the answer text plus its citations, per the Responses API's documented
 * output shape (a web_search_call item followed by a message item). Null
 * when the response has no such item (e.g. the model only ever emitted a
 * web_search_call and never answered) — treated as an empty-answer
 * failure by the caller, not silently rendered as "". */
function extractAnswer(output: ResponsesApiOutputItem[] | undefined): { text: string; sources: AiVisibilitySource[] } | null {
  if (!output) return null;
  for (const item of output) {
    if (item.type !== "message" || !item.content) continue;
    for (const block of item.content) {
      if (block.type === "output_text" && typeof block.text === "string") {
        return { text: block.text, sources: normalizeAnnotations(block.annotations) };
      }
    }
  }
  return null;
}

/**
 * Executes one question against OpenAI's Responses API with the web_search
 * tool enabled. Never throws — every failure mode (missing configuration,
 * network/timeout, non-2xx response, empty answer) returns a typed
 * `{ ok: false }` result instead, so a single question's failure can never
 * crash a run of several questions (see runAiVisibility.ts).
 *
 * `model` is read from `OPENAI_MODEL` rather than hardcoded: OpenAI's
 * current model lineup couldn't be independently verified beyond the
 * documentation excerpts available at implementation time, and CLAUDE.md's
 * instruction to never invent/hardcode unverified configuration applies
 * here the same way it does to credentials — an operator must supply the
 * exact production model identifier (see .env.example).
 */
export async function callOpenAiWebSearch(questionText: string): Promise<AiVisibilityProviderResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;

  if (!apiKey) {
    return {
      ok: false,
      provider: "openai",
      model: model ?? "unknown",
      error: "OPENAI_API_KEY is not configured.",
    };
  }
  if (!model) {
    return {
      ok: false,
      provider: "openai",
      model: "unknown",
      error: "OPENAI_MODEL is not configured.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: questionText,
        tools: [{ type: "web_search" }],
      }),
    });
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `Timed out after ${REQUEST_TIMEOUT_MS / 1000}s waiting for OpenAI.`
        : "Could not reach OpenAI.";
    return { ok: false, provider: "openai", model, error: message };
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    return { ok: false, provider: "openai", model, error: describeOpenAiApiError(response.status) };
  }

  let payload: ResponsesApiPayload;
  try {
    payload = (await response.json()) as ResponsesApiPayload;
  } catch {
    return { ok: false, provider: "openai", model, error: "OpenAI returned an unreadable response." };
  }

  const answer = extractAnswer(payload.output);
  if (!answer || answer.text.trim() === "") {
    return { ok: false, provider: "openai", model, error: "OpenAI returned an empty answer." };
  }

  return {
    ok: true,
    provider: "openai",
    model,
    answerText: answer.text,
    sources: answer.sources,
    usage: payload.usage ?? null,
    raw: payload,
  };
}
