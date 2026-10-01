import { countUniqueSources, extractCompetitors, type CompetitorClientIdentity } from "./competitors";
import type { AiVisibilitySource } from "./providers/types";

/** The persisted fields a provider result summary is derived from. */
export type AiVisibilityResultEvidence = {
  status: string;
  answer_text: string | null;
  sources: unknown;
  raw_response: unknown;
};

export type AiVisibilityResultSummary = {
  /** Unique competitors, in the order presented. Null for a failed result —
   * never shown as a fake "0". */
  competitors: string[] | null;
  /** Unique source URLs. Null for a failed result. */
  sourceCount: number | null;
};

export function asSources(value: unknown): AiVisibilitySource[] {
  return Array.isArray(value) ? (value as AiVisibilitySource[]) : [];
}

/** Browser results keep the rendered answer HTML in raw_response; it holds
 * the structure (lists, tables, business cards) competitor extraction reads. */
export function answerHtmlFrom(rawResponse: unknown): string | null {
  if (!rawResponse || typeof rawResponse !== "object") return null;
  const html = (rawResponse as Record<string, unknown>).answerHtml;
  return typeof html === "string" && html !== "" ? html : null;
}

/** Provider-level KPIs derived deterministically from a result's persisted
 * evidence (Mentioned/Cited are already persisted columns). */
export function summarizeAiVisibilityResult(
  result: AiVisibilityResultEvidence,
  client: CompetitorClientIdentity,
): AiVisibilityResultSummary {
  if (result.status !== "completed") return { competitors: null, sourceCount: null };
  return {
    competitors: extractCompetitors(
      { answerHtml: answerHtmlFrom(result.raw_response), answerText: result.answer_text },
      client,
    ),
    sourceCount: countUniqueSources(asSources(result.sources)),
  };
}
