import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeOrganizationName } from "@/lib/organizationName";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Route Handlers (unlike Server Components) can safely write cookies,
      // so this — not requireUserAndOrganization()'s Server-Component-side
      // fallback — is the right place to call supabase.auth.updateUser()
      // (used below to clear the pending-org-name metadata once consumed).
      await createOrganizationFromPendingSignup(supabase);
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login`);
}

/**
 * Consumes a `pending_organization_name` set at signup (src/app/login/page.tsx)
 * for a freshly-verified user, on the first authenticated moment available —
 * right after the auth code exchange above. Never throws: any failure here
 * must not block the redirect to /dashboard, which has its own fallback
 * (requireUserAndOrganization, then the manual "Create your organization"
 * screen) if this doesn't run or doesn't succeed.
 */
async function createOrganizationFromPendingSignup(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: membership, error: membershipError } = await supabase
      .from("organization_memberships")
      .select("organization_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    // Already has an org (or the lookup itself failed) — nothing to do;
    // requireUserAndOrganization will handle either case on dashboard load.
    if (membershipError || membership) return;

    const pendingName = user.user_metadata?.pending_organization_name;
    if (typeof pendingName !== "string") return;

    const normalized = normalizeOrganizationName(pendingName);

    if (!normalized) {
      // Nothing usable to create from — clear it so it doesn't linger.
      const { error } = await supabase.auth.updateUser({
        data: { pending_organization_name: null },
      });
      if (error) {
        console.error("[org-onboarding] auth/callback: failed to clear invalid pending name", {
          message: error.message,
        });
      }
      return;
    }

    const { error: rpcError } = await supabase.rpc("create_organization", {
      org_name: normalized,
    });

    if (rpcError) {
      console.error("[org-onboarding] auth/callback: create_organization RPC failed", {
        code: rpcError.code,
        message: rpcError.message,
      });
      // Leave the pending value in place — a later load can retry via
      // requireUserAndOrganization's fallback.
      return;
    }

    const { error: clearError } = await supabase.auth.updateUser({
      data: { pending_organization_name: null },
    });
    if (clearError) {
      // Non-fatal: the organization + membership already exist, so no
      // future call will re-attempt creation for this user regardless.
      console.error("[org-onboarding] auth/callback: failed to clear pending name after creation", {
        message: clearError.message,
      });
    }
  } catch (err) {
    console.error("[org-onboarding] auth/callback: unexpected error", {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
