import { normalizeHostname } from "./domain";
import type { AiVisibilitySource } from "./providers/types";

/**
 * Deterministic, explainable first-pass AI Visibility metrics — no second
 * evaluator LLM, no subjective scoring (CLAUDE.md: "Use deterministic code
 * when the answer is deterministic"). Every function here is pure and
 * returns `null` rather than `false`/`0` exactly when the input doesn't
 * support a real evaluation, so "not evaluated" stays distinguishable from
 * a genuine negative result at every layer (metrics -> persistence -> UI).
 *
 * Recommended/Accuracy/Sentiment/a final Prominence score are deliberately
 * NOT implemented here — they need a separately defined evaluation
 * methodology and/or ground truth (see PROJECT_STATUS.md).
 */

/**
 * Mentioned: a case-insensitive substring match of the site's canonical
 * business name (`sites.name` — the name MARKO already asks for at site
 * creation, the only canonical brand/entity identity MARKO currently
 * stores) against the provider's answer text. Returns `null` — not
 * evaluated — when `brandName` is blank, rather than guessing at an
 * identity MARKO doesn't actually have configured.
 *
 * Deliberately simple and explainable: no stemming, no fuzzy/semantic
 * matching, no synonym list. A brand name that's genuinely written
 * differently in the answer (e.g. an unexpected abbreviation) will read as
 * "not mentioned" — a known, documented limitation of this first-pass
 * metric, not a bug.
 */
export function computeMentioned(answerText: string, brandName: string): boolean | null {
  const normalizedBrand = brandName.trim();
  if (normalizedBrand === "") return null;
  return answerText.toLowerCase().includes(normalizedBrand.toLowerCase());
}

/**
 * Prominence (deterministic only, per this slice's strict scope): the
 * character index of the first case-insensitive occurrence of the site's
 * brand name in the answer text — a plain, explainable "how early does
 * this appear" position, deliberately NOT a normalized/weighted
 * "prominence score". Null when not mentioned, or when `brandName` is
 * blank (nothing to search for).
 */
export function computeFirstMentionIndex(answerText: string, brandName: string): number | null {
  const normalizedBrand = brandName.trim();
  if (normalizedBrand === "") return null;
  const index = answerText.toLowerCase().indexOf(normalizedBrand.toLowerCase());
  return index === -1 ? null : index;
}

/**
 * Cited: whether any of the provider's returned sources resolves to the
 * same domain as the analyzed site — never inferred merely because the
 * brand name appears in the answer text (a citation is a distinct,
 * stronger signal than a mention). Uses normalized (lowercased,
 * "www."-stripped) hostname comparison, the same normalization every
 * source already carries (see providers/openai.ts) and the site side gets
 * here via `normalizeHostname`. Returns `null` when the site's own URL
 * doesn't parse into a usable hostname at all (nothing to compare
 * against) — never silently `false`.
 */
export function computeCited(sources: AiVisibilitySource[], siteUrl: string): boolean | null {
  const siteDomain = normalizeHostname(siteUrl);
  if (!siteDomain) return null;
  return sources.some((source) => source.domain !== null && source.domain === siteDomain);
}
