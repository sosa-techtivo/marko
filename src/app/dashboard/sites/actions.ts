"use server";

import { createClient } from "@/lib/supabase/server";
import { requireUserAndOrganization } from "@/lib/organizations";
import { resolveUniqueSlug, slugify } from "@/lib/sites/slug";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type CreateSiteState = {
  error: "missing-fields" | "save-failed" | "no-organization" | null;
  success: boolean;
};

/** Postgres's unique_violation error code — used to detect the narrow race
 * where two sites with the same base slug are created concurrently in the
 * same organization (see the retry below). */
const UNIQUE_VIOLATION = "23505";

/** Slug candidate for `baseSlug`, unique among this organization's
 * existing sites — `sites_organization_id_slug_key`
 * (supabase/migrations/0011_site_slugs.sql) is the actual source of truth
 * for uniqueness; this is a best-effort pre-check that avoids a
 * constraint-violation round trip in the common case. Only fetches slugs
 * that could plausibly collide (`baseSlug` itself or `baseSlug-N`), not
 * every site in the organization. */
async function computeUniqueSlugForOrg(
  supabase: SupabaseServerClient,
  organizationId: string,
  baseSlug: string,
): Promise<string> {
  const { data } = await supabase.from("sites").select("slug").eq("organization_id", organizationId);
  const relevant = (data ?? [])
    .map((row) => row.slug)
    .filter((slug): slug is string => slug === baseSlug || slug.startsWith(`${baseSlug}-`));
  return resolveUniqueSlug(baseSlug, relevant);
}

export async function createSite(
  _prevState: CreateSiteState,
  formData: FormData,
): Promise<CreateSiteState> {
  const { organization } = await requireUserAndOrganization();
  if (!organization) {
    return { error: "no-organization", success: false };
  }

  const name = String(formData.get("name") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();

  if (!name || !url) {
    return { error: "missing-fields", success: false };
  }

  const supabase = await createClient();
  const baseSlug = slugify(name);
  const slug = await computeUniqueSlugForOrg(supabase, organization.id, baseSlug);

  const { error } = await supabase.from("sites").insert({
    organization_id: organization.id,
    name,
    url,
    slug,
  });

  if (error && error.code === UNIQUE_VIOLATION) {
    // Rare race: another site with the same base slug was created
    // concurrently between the pre-check above and this insert. Recompute
    // once against the now-current state and retry; if that still
    // collides, fall through to the generic save-failed error below
    // rather than looping indefinitely.
    const retrySlug = await computeUniqueSlugForOrg(supabase, organization.id, baseSlug);
    const retry = await supabase
      .from("sites")
      .insert({ organization_id: organization.id, name, url, slug: retrySlug });
    if (retry.error) {
      return { error: "save-failed", success: false };
    }
    return { error: null, success: true };
  }

  if (error) {
    return { error: "save-failed", success: false };
  }

  return { error: null, success: true };
}

export type SiteLifecycleResult = { error: string | null };

const GENERIC_LIFECYCLE_ERROR = "Something went wrong. Please try again.";

/** Active -> archived. Crawl history is untouched — only the RPC in
 * 0006_site_archive.sql runs, no crawl_runs/crawl_pages/crawl_issues
 * queries here. */
export async function archiveSite(siteId: string): Promise<SiteLifecycleResult> {
  const { organization } = await requireUserAndOrganization();
  if (!organization) {
    return { error: GENERIC_LIFECYCLE_ERROR };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("archive_site", { site_id: siteId });

  if (error) {
    console.error("[archiveSite] archive_site RPC failed", {
      code: error.code,
      message: error.message,
    });
    return { error: "Could not archive this site. Please try again." };
  }

  return { error: null };
}

/** Archived -> active. */
export async function restoreSite(siteId: string): Promise<SiteLifecycleResult> {
  const { organization } = await requireUserAndOrganization();
  if (!organization) {
    return { error: GENERIC_LIFECYCLE_ERROR };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("restore_site", { site_id: siteId });

  if (error) {
    console.error("[restoreSite] restore_site RPC failed", {
      code: error.code,
      message: error.message,
    });
    return { error: "Could not restore this site. Please try again." };
  }

  return { error: null };
}

/** Permanently removes the site row; crawl_runs/crawl_pages/crawl_issues
 * cascade-delete via their existing FKs (see 0003_seo_crawl.sql) — the RPC
 * itself only deletes from `sites`. Only succeeds for an already-archived
 * site — enforced in delete_site_permanently itself, not just by the UI
 * only exposing this action on archived cards. */
export async function deleteSitePermanently(siteId: string): Promise<SiteLifecycleResult> {
  const { organization } = await requireUserAndOrganization();
  if (!organization) {
    return { error: GENERIC_LIFECYCLE_ERROR };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_site_permanently", { site_id: siteId });

  if (error) {
    console.error("[deleteSitePermanently] delete_site_permanently RPC failed", {
      code: error.code,
      message: error.message,
    });
    return { error: "Could not delete this site. Please try again." };
  }

  return { error: null };
}
