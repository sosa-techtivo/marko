/**
 * Shared organization-name validation, used both client-side (signup form)
 * and server-side (pending-signup auto-creation). No Next.js-specific
 * imports, so it's safe from either environment.
 */
export const ORGANIZATION_NAME_MAX_LENGTH = 100;

/** Trims and caps a candidate organization name; returns null if empty. */
export function normalizeOrganizationName(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, ORGANIZATION_NAME_MAX_LENGTH);
}
