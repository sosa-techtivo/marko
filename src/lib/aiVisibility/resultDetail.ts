import type { createClient } from "@/lib/supabase/server";
import type { AiVisibilitySource } from "./providers/types";
import { asSources, summarizeAiVisibilityResult } from "./resultSummary";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** raw_response keys safe and useful to show as technical evidence — a
 * strict allowlist of primitive values (never the HTML dump, source
 * payloads, or anything else that happens to be in raw_response). */
const EVIDENCE_FIELDS: { key: string; label: string }[] = [
  { key: "surface", label: "Surface" },
  { key: "conversationUrl", label: "Conversation URL" },
  { key: "capturedAt", label: "Captured at" },
  { key: "signedIn", label: "Signed in" },
  { key: "citationChipCount", label: "Citation chips" },
  { key: "sourcePayloadCount", label: "Source references" },
  { key: "answerLinkCount", label: "Answer links" },
  { key: "sourcesExtractionComplete", label: "Source extraction complete" },
  { key: "httpStatus", label: "HTTP status" },
  { key: "errorStatus", label: "Error status" },
];

export type AiVisibilityResultEvidenceField = { label: string; value: string };

export type AiVisibilityProviderResultDetail = {
  id: string;
  runId: string;
  runStartedAt: string;
  executionMethod: string;
  questionText: string;
  category: string | null;
  provider: string;
  model: string;
  status: string;
  mentioned: boolean | null;
  cited: boolean | null;
  firstMentionIndex: number | null;
  competitors: string[] | null;
  sourceCount: number | null;
  sources: AiVisibilitySource[];
  answerText: string | null;
  errorMessage: string | null;
  evidence: AiVisibilityResultEvidenceField[];
};

export function pickEvidenceFields(rawResponse: unknown): AiVisibilityResultEvidenceField[] {
  if (!rawResponse || typeof rawResponse !== "object") return [];
  const raw = rawResponse as Record<string, unknown>;
  const fields: AiVisibilityResultEvidenceField[] = [];
  for (const { key, label } of EVIDENCE_FIELDS) {
    const value = raw[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      fields.push({ label, value: typeof value === "boolean" ? (value ? "Yes" : "No") : String(value) });
    }
  }
  return fields;
}

/**
 * Loads exactly one provider result for its detail page. Tenant-scoped like
 * every other AI Visibility read: the result must belong to the caller's
 * organization AND its run must belong to `siteId` — so a result id from
 * another site or organization resolves to null, the same as a missing one.
 * Only this one row's answer/evidence is returned, never a sibling
 * provider's.
 */
export async function loadAiVisibilityResultDetail(
  supabase: SupabaseServerClient,
  organizationId: string,
  site: { id: string; name: string; url: string; effective_url: string | null },
  resultId: string,
): Promise<AiVisibilityProviderResultDetail | null> {
  const { data: result } = await supabase
    .from("ai_visibility_results")
    .select(
      "id, run_id, question_id, provider, model, execution_method, status, answer_text, sources, raw_response, mentioned, cited, first_mention_index, error_message",
    )
    .eq("id", resultId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!result) return null;

  const { data: run } = await supabase
    .from("ai_visibility_runs")
    .select("id, started_at")
    .eq("id", result.run_id)
    .eq("site_id", site.id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!run) return null;

  const { data: question } = await supabase
    .from("ai_visibility_questions")
    .select("question_text, category")
    .eq("id", result.question_id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  const summary = summarizeAiVisibilityResult(result, { brandName: site.name, siteUrl: site.effective_url ?? site.url });

  return {
    id: result.id,
    runId: run.id,
    runStartedAt: run.started_at,
    executionMethod: result.execution_method,
    questionText: question?.question_text ?? "(question no longer available)",
    category: question?.category ?? null,
    provider: result.provider,
    model: result.model,
    status: result.status,
    mentioned: result.mentioned,
    cited: result.cited,
    firstMentionIndex: result.first_mention_index,
    competitors: summary.competitors,
    sourceCount: summary.sourceCount,
    sources: asSources(result.sources),
    answerText: result.answer_text,
    errorMessage: result.error_message,
    evidence: pickEvidenceFields(result.raw_response),
  };
}
