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
