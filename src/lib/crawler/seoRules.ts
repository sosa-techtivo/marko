/**
 * Conventional, deterministic length thresholds for title/meta description
 * checks. Shared between `analyze.ts` (which applies them) and
 * `src/lib/reporting/issueTaxonomy.ts` (which cites them in recommendation
 * copy) — kept in this neutral module so neither one "owns" the other's
 * dependency.
 *  - Title: ~30–60 characters is the commonly cited range balancing
 *    descriptiveness against Google's typical ~50–60 char / ~600px
 *    truncation of the title link in results.
 *  - Meta description: ~50–160 characters — under ~50 is generally too
 *    thin to be a useful snippet; Google typically truncates snippets
 *    around 155–160 characters.
 */
export const TITLE_MIN_LENGTH = 30;
export const TITLE_MAX_LENGTH = 60;
export const META_DESCRIPTION_MIN_LENGTH = 50;
export const META_DESCRIPTION_MAX_LENGTH = 160;
