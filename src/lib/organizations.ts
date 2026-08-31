import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export type CurrentOrganization = {
  id: string;
  name: string;
};

/**
 * A user has no organization until they explicitly create one (see
 * supabase/migrations/0001_init.sql: create_organization). "Current
 * organization" is the earliest membership. There is no org switcher yet.
 */
export async function requireUserAndOrganization(): Promise<{
  user: User;
  organization: CurrentOrganization | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organization_memberships")
    .select("organization_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    console.error(
      "[requireUserAndOrganization] organization_memberships lookup failed",
      {
        code: membershipError.code,
        message: membershipError.message,
        details: membershipError.details,
        hint: membershipError.hint,
      },
    );
  }

  if (!membership) {
    return { user, organization: null };
  }

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", membership.organization_id)
    .maybeSingle();

  if (organizationError) {
    console.error("[requireUserAndOrganization] organizations lookup failed", {
      code: organizationError.code,
      message: organizationError.message,
      details: organizationError.details,
      hint: organizationError.hint,
    });
  }

  return { user, organization: organization ?? null };
}
