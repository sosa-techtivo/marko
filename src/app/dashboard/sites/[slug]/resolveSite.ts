import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type ResolvedSite = {
  id: string;
  name: string;
  url: string;
  slug: string;
  favicon_url: string | null;
  search_console_property_url: string | null;
  search_console_property_type: string | null;
};

/**
 * Resolves this route's `slug` param to the actual Site row, scoped to the
 * caller's own organization. A slug is only unique *within* an organization
 * (see supabase/migrations/0011_site_slugs.sql), so the `organization_id`
 * filter is not optional: without it, a slug that happens to collide with
 * another organization's site could resolve into that other tenant's data.
 * RLS (`sites`' "members can view sites in their organizations" policy)
 * independently enforces the same boundary — this is the same explicit
 * double-check pattern already used by getCrawlRunDetail/
 * associateSiteProperty (see actions.ts/googleSearchConsoleActions.ts).
 *
 * Returns `null` for no match, whether that's because the slug doesn't
 * exist at all or because it belongs to a different organization — the
 * caller can't distinguish those cases (nor should it: doing so would leak
 * whether a given slug exists elsewhere).
 */
export async function resolveSiteBySlug(
  supabase: SupabaseServerClient,
  organizationId: string,
  slug: string,
): Promise<ResolvedSite | null> {
  const { data } = await supabase
    .from("sites")
    .select(
      "id, name, url, slug, favicon_url, search_console_property_url, search_console_property_type",
    )
    .eq("organization_id", organizationId)
    .eq("slug", slug)
    .maybeSingle();

  return data ?? null;
}
