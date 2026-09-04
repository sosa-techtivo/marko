/**
 * Deterministic, human-readable filename for a site's downloadable SEO
 * report — e.g. "MARKO-SEO-Report-Techtivo-2026-09-04.pdf". Never exposes
 * a site's internal UUID; the site's own name is the only site-specific
 * input, sanitized to plain ASCII alphanumerics/hyphens so it's safe as a
 * filename on every OS/browser regardless of what characters the user
 * typed when naming the site.
 */
export function buildReportFilename(siteName: string, generatedAt: Date): string {
  const sanitized = sanitizeForFilename(siteName);
  const date = generatedAt.toISOString().slice(0, 10);
  return `MARKO-SEO-Report-${sanitized}-${date}.pdf`;
}

// Unicode code points 0x0300-0x036F are the "Combining Diacritical Marks"
// block — after NFKD normalization, an accented character like "e" with
// an acute accent decomposes into a plain base letter plus one of these
// combining marks, so stripping this range turns it into the plain ASCII
// letter instead of dropping the character outright. Built from numeric
// code points (not a literal escape in source) so this file only ever
// contains plain ASCII, regardless of editor/encoding.
const COMBINING_DIACRITICS_START = 0x0300;
const COMBINING_DIACRITICS_END = 0x036f;
const COMBINING_DIACRITICS = new RegExp(
  `[\\u${COMBINING_DIACRITICS_START.toString(16).padStart(4, "0")}-\\u${COMBINING_DIACRITICS_END.toString(16).padStart(4, "0")}]`,
  "g",
);

function sanitizeForFilename(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(COMBINING_DIACRITICS, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "Site";
}
