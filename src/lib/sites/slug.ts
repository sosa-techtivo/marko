/**
 * Site slug generation — pure, deterministic, and independently testable
 * (see slug.test.ts). Used by createSite
 * (src/app/dashboard/sites/actions.ts) to derive a URL-safe slug from a
 * site's name at creation time, unique within its organization (see
 * `sites_organization_id_slug_key` in supabase/migrations/0011_site_slugs.sql
 * — the actual source of truth for uniqueness; `resolveUniqueSlug`'s
 * `existingSlugs` check is a best-effort pre-check that avoids a
 * constraint-violation round trip in the common case, not a substitute for
 * it).
 */

const MAX_SLUG_LENGTH = 60;

/**
 * URL-safe slug derived from a site name: lowercased, non-alphanumeric
 * runs collapsed to a single '-', leading/trailing '-' trimmed, capped at
 * MAX_SLUG_LENGTH characters (with any trailing '-' left by truncation
 * trimmed again). Falls back to "site" if the name has no alphanumeric
 * characters at all (e.g. "!!!").
 */
export function slugify(name: string): string {
  const collapsed = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const truncated = collapsed.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "");

  return truncated || "site";
}

/**
 * First slug not already in `existingSlugs`: `base`, then `base-2`,
 * `base-3`, … in ascending order — deterministic, never random, so the
 * same inputs always produce the same result. `existingSlugs` should
 * already be scoped to the target organization (slugs are unique per
 * organization, not globally).
 */
export function resolveUniqueSlug(base: string, existingSlugs: Iterable<string>): string {
  const taken = new Set(existingSlugs);
  if (!taken.has(base)) return base;

  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) {
    suffix++;
  }
  return `${base}-${suffix}`;
}
