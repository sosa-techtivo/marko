import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { normalizeOrganizationName } from "@/lib/organizationName";

export type CurrentOrganization = {
  id: string;
  name: string;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function fetchEarliestMembership(supabase: SupabaseServerClient, userId: string) {
  const { data, error } = await supabase
    .from("organization_memberships")
    .select("organization_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[organizations] organization_memberships lookup failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
  }

  return data;
}

async function fetchOrganization(
  supabase: SupabaseServerClient,
  organizationId: string,
): Promise<CurrentOrganization | null> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", organizationId)
    .maybeSingle();

  if (error) {
    console.error("[organizations] organizations lookup failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
  }

  return data ?? null;
}

/**
 * Fallback auto-creation for a user whose first authenticated page load did
 * NOT go through /auth/callback (e.g. they verified earlier and are signing
 * in normally later) — the callback route (src/app/auth/callback/route.ts)
 * is the primary place this happens, since it runs in a context that can
 * safely touch the auth session.
 *
 * IMPORTANT: this function deliberately calls ONLY the create_organization
 * RPC — a plain Postgrest call with no session/cookie side effects, same as
 * every other query in this file. It must NEVER call
 * supabase.auth.updateUser() (or any other session-mutating auth method):
 * this function runs from Server Components (dashboard/layout.tsx,
 * dashboard/page.tsx, ...), and Server Components cannot write cookies. An
 * earlier version called updateUser() here to clear the pending-name
 * metadata; updateUser() fires a USER_UPDATED auth event that
 * @supabase/ssr's client listens for to persist the session via a cookie
 * write, which stalled indefinitely from this context — that was the exact
 * cause of the infinite dashboard load this function's history refers to.
 *
 * Not clearing the pending metadata here is fine: membership existence, not
 * metadata absence, is the actual idempotency guard (see
 * requireUserAndOrganization below) — once create_organization succeeds, a
 * membership row exists and this function is never reached again for this
 * user, regardless of whether the metadata still says pending.
 */
async function createOrganizationFromPendingSignup(
  supabase: SupabaseServerClient,
  user: User,
): Promise<void> {
  const pendingName = user.user_metadata?.pending_organization_name;
  if (typeof pendingName !== "string") return;

  const normalized = normalizeOrganizationName(pendingName);
  if (!normalized) return;

  const { error: rpcError } = await supabase.rpc("create_organization", {
    org_name: normalized,
  });

  if (rpcError) {
    console.error("[createOrganizationFromPendingSignup] create_organization RPC failed", {
      code: rpcError.code,
      message: rpcError.message,
    });
    // Leave the pending value in place — a later load can retry.
  }
}

/**
 * A user has no organization until one exists for them — either created
 * manually via the "Create your organization" screen, or automatically
 * from a `pending_organization_name` captured at signup (see
 * src/app/login/page.tsx and src/app/auth/callback/route.ts). "Current
 * organization" is the earliest membership. There is no org switcher yet.
 *
 * Wrapped in React's `cache()`: Next.js fetches a layout and its page in
 * parallel, and both dashboard/layout.tsx and dashboard/page.tsx call this
 * — without deduping, the pending-signup auto-creation below would race
 * itself on every first load.
 */
export const requireUserAndOrganization = cache(async (): Promise<{
  user: User;
  organization: CurrentOrganization | null;
}> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let membership = await fetchEarliestMembership(supabase, user.id);

  if (!membership) {
    try {
      await createOrganizationFromPendingSignup(supabase, user);
    } catch (err) {
      // Never let auto-creation take down the page load — fall through to
      // the manual "Create your organization" screen either way.
      console.error("[org-onboarding] dashboard fallback threw", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
    membership = await fetchEarliestMembership(supabase, user.id);
  }

  if (!membership) {
    return { user, organization: null };
  }

  return { user, organization: await fetchOrganization(supabase, membership.organization_id) };
});
