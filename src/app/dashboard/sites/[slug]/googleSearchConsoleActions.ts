"use server";

import { revalidatePath } from "next/cache";
import { requireUserAndOrganization } from "@/lib/organizations";
import { createClient } from "@/lib/supabase/server";
import { getValidAccessToken } from "@/lib/googleSearchConsole/tokens";
import { listSearchConsoleProperties } from "@/lib/googleSearchConsole/client";
import type { SearchConsoleProperty, SearchConsolePropertyType } from "@/lib/googleSearchConsole/propertyMatching";
import { siteDetailPath } from "@/lib/sites/paths";

export type ListPropertiesResult =
  | { ok: true; properties: SearchConsoleProperty[] }
  | { ok: false; error: string };

function connectionErrorMessage(reason: "not_connected" | "needs_reauth" | "refresh_failed"): string {
  if (reason === "needs_reauth") return "Reconnect Google Search Console to continue.";
  if (reason === "refresh_failed") return "Could not refresh the Google Search Console connection.";
  return "Google Search Console is not connected.";
}

/** The Search Console properties available to this organization's
 * connected Google account — fetched live, only when the UI actually
 * needs the list (the property selector), not on every page load. */
export async function listAvailableProperties(): Promise<ListPropertiesResult> {
  const { organization } = await requireUserAndOrganization();
  if (!organization) return { ok: false, error: "Something went wrong. Please try again." };

  const tokenResult = await getValidAccessToken(organization.id);
  if (!tokenResult.ok) return { ok: false, error: connectionErrorMessage(tokenResult.reason) };

  const result = await listSearchConsoleProperties(tokenResult.accessToken);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, properties: result.properties };
}

export type AssociatePropertyResult = { ok: true } | { ok: false; error: string };

/**
 * Associates a site with one Search Console property. Never trusts the
 * client-submitted (propertyUrl, propertyType) pair blindly: re-fetches
 * the connected account's live property list server-side and confirms
 * this exact property is one it actually has access to before persisting
 * anything — a malicious or stale client can't associate a property the
 * connected account doesn't own.
 */
export async function associateSiteProperty(
  siteId: string,
  propertyUrl: string,
  propertyType: string,
): Promise<AssociatePropertyResult> {
  if (propertyType !== "url_prefix" && propertyType !== "domain") {
    return { ok: false, error: "Invalid property type." };
  }
  const validatedType: SearchConsolePropertyType = propertyType;

  const { organization } = await requireUserAndOrganization();
  if (!organization) return { ok: false, error: "Something went wrong. Please try again." };

  const tokenResult = await getValidAccessToken(organization.id);
  if (!tokenResult.ok) return { ok: false, error: connectionErrorMessage(tokenResult.reason) };

  const listed = await listSearchConsoleProperties(tokenResult.accessToken);
  if (!listed.ok) return { ok: false, error: listed.error };

  const isOwnedProperty = listed.properties.some((property) => property.siteUrl === propertyUrl);
  if (!isOwnedProperty) {
    return { ok: false, error: "That property is not available on the connected Google account." };
  }

  const supabase = await createClient();

  // Tenant ownership check on top of the RPC's own (see
  // set_site_search_console_property in 0009_google_search_console.sql) —
  // same double-check pattern as getCrawlRunDetail in actions.ts. Also
  // fetches `slug` — needed for revalidatePath below, since the site
  // detail route is slug-based (see 0011_site_slugs.sql).
  const { data: site } = await supabase
    .from("sites")
    .select("id, slug")
    .eq("id", siteId)
    .eq("organization_id", organization.id)
    .maybeSingle();
  if (!site) return { ok: false, error: "Site not found." };

  const { error } = await supabase.rpc("set_site_search_console_property", {
    site_id: siteId,
    property_url: propertyUrl,
    property_type: validatedType,
  });

  if (error) {
    console.error("[googleSearchConsole] set_site_search_console_property failed", {
      code: error.code,
      message: error.message,
    });
    return { ok: false, error: "Could not save the selected property." };
  }

  revalidatePath(siteDetailPath(site.slug));
  return { ok: true };
}
