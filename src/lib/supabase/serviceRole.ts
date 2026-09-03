import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * A Supabase client authenticated as `service_role`, which bypasses Row
 * Level Security entirely. This is the ONLY client in the project allowed
 * to touch `google_connections` (see 0009_google_search_console.sql — that
 * table intentionally has no grants/policies for `authenticated`/`anon`,
 * so this is also the only client that even *can* touch it).
 *
 * Reads `SUPABASE_SERVICE_ROLE_KEY` — deliberately not `NEXT_PUBLIC_`
 * prefixed, so Next.js never inlines it into a client bundle; this module
 * must only ever be imported from server-only code (Server Actions, Route
 * Handlers), never from a file marked "use client". Every caller MUST
 * independently verify the requesting user's organization membership
 * before using this client (it does not check — it bypasses the
 * database's own tenant checks by design), which is why this is only ever
 * called from src/lib/googleSearchConsole/connectionStore.ts, itself only
 * called after requireUserAndOrganization().
 *
 * No session/cookies involved — this key is a standing server credential,
 * not tied to any particular user's request.
 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — required for Google Search Console token storage.",
    );
  }

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
