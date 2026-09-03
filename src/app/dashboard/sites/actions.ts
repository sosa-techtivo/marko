"use server";

import { createClient } from "@/lib/supabase/server";
import { requireUserAndOrganization } from "@/lib/organizations";

export type CreateSiteState = {
  error: "missing-fields" | "save-failed" | "no-organization" | null;
  success: boolean;
};

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
  const { error } = await supabase.from("sites").insert({
    organization_id: organization.id,
    name,
    url,
  });

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
