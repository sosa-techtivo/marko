import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type GoogleConnectionStatus =
  | { connected: false }
  | { connected: true; needsReauth: boolean; connectedAt: string | null };

/**
 * Non-sensitive connection status only (never the tokens) — safe to call
 * from a Server Component with the normal RLS-scoped client, via the
 * get_google_connection_status() security-definer RPC (see
 * 0009_google_search_console.sql). `organizationId` is not independently
 * re-validated here; the RPC itself re-checks the caller's membership.
 */
export async function getGoogleConnectionStatus(
  supabase: SupabaseServerClient,
  organizationId: string,
): Promise<GoogleConnectionStatus> {
  const { data, error } = await supabase.rpc("get_google_connection_status", {
    p_organization_id: organizationId,
  });

  if (error) {
    console.error("[googleSearchConsole] get_google_connection_status RPC failed", {
      code: error.code,
      message: error.message,
    });
    return { connected: false };
  }

  const row = data?.[0];
  if (!row || !row.connected) return { connected: false };

  return { connected: true, needsReauth: row.needs_reauth, connectedAt: row.connected_at };
}
