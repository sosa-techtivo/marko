/**
 * Canonical path to a Site's detail dashboard page — always slug-based
 * (see supabase/migrations/0011_site_slugs.sql). The Site's internal UUID
 * (`sites.id`) is never used to build this URL; every place that links or
 * redirects to a site's detail page should go through this one function
 * rather than interpolating a path string itself.
 */
export function siteDetailPath(slug: string): string {
  return `/dashboard/sites/${slug}`;
}

/** Canonical path to a Site's downloadable current-SEO-report PDF (see
 * src/app/dashboard/sites/[slug]/report/route.ts) — same slug-based
 * convention as siteDetailPath, built from it rather than duplicating the
 * base path. */
export function siteReportPdfPath(slug: string): string {
  return `${siteDetailPath(slug)}/report`;
}
