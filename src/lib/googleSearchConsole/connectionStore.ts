import { createServiceRoleClient } from "@/lib/supabase/serviceRole";

/**
 * The only module in the project allowed to read/write
 * `google_connections` (see 0009_google_search_console.sql and
 * src/lib/supabase/serviceRole.ts for why). Every export here takes an
 * `organizationId` the caller must already have verified belongs to the
 * requesting user — this module does not re-check membership itself,
 * since the service-role client bypasses RLS and could not enforce it
 * anyway.
 */

export type GoogleConnectionRecord = {
  refreshToken: string;
  accessToken: string | null;
  accessTokenExpiresAt: string | null;
  needsReauth: boolean;
};

export async function getConnectionRecord(organizationId: string): Promise<GoogleConnectionRecord | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("google_connections")
    .select("refresh_token, access_token, access_token_expires_at, needs_reauth")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    console.error("[googleSearchConsole] connection lookup failed", {
      code: error.code,
      message: error.message,
    });
    return null;
  }
  if (!data) return null;

  return {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    accessTokenExpiresAt: data.access_token_expires_at,
    needsReauth: data.needs_reauth,
  };
}

/**
 * Called right after a successful OAuth code exchange. `refreshToken` is
 * `null` when Google didn't return a new one on this consent (it only
 * reliably does on first consent, or when `prompt=consent` forces it —
 * this project always passes `prompt=consent`, but stays defensive) — in
 * that case the previously-stored refresh token is left untouched rather
 * than being overwritten with nothing.
 */
export async function upsertConnection(params: {
  organizationId: string;
  connectedBy: string;
  refreshToken: string | null;
  accessToken: string;
  accessTokenExpiresAt: string;
  scope: string;
}): Promise<{ ok: boolean }> {
  const supabase = createServiceRoleClient();
  const nowIso = new Date().toISOString();

  if (params.refreshToken) {
    const { error } = await supabase.from("google_connections").upsert(
      {
        organization_id: params.organizationId,
        connected_by: params.connectedBy,
        refresh_token: params.refreshToken,
        access_token: params.accessToken,
        access_token_expires_at: params.accessTokenExpiresAt,
        scope: params.scope,
        needs_reauth: false,
        updated_at: nowIso,
      },
      { onConflict: "organization_id" },
    );

    if (error) {
      console.error("[googleSearchConsole] connection upsert failed", {
        code: error.code,
        message: error.message,
      });
      return { ok: false };
    }
    return { ok: true };
  }

  // No new refresh token — only update the access token, and only if a
  // connection already exists to update (otherwise there's no refresh
  // token to fall back on at all, which is an unrecoverable state here).
  const { data, error } = await supabase
    .from("google_connections")
    .update({
      access_token: params.accessToken,
      access_token_expires_at: params.accessTokenExpiresAt,
      scope: params.scope,
      needs_reauth: false,
      updated_at: nowIso,
    })
    .eq("organization_id", params.organizationId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    console.error("[googleSearchConsole] connection update failed with no refresh token to fall back on", {
      code: error?.code,
      message: error?.message,
    });
    return { ok: false };
  }
  return { ok: true };
}

export async function updateAccessToken(params: {
  organizationId: string;
  accessToken: string;
  accessTokenExpiresAt: string;
}): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("google_connections")
    .update({
      access_token: params.accessToken,
      access_token_expires_at: params.accessTokenExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", params.organizationId);

  if (error) {
    console.error("[googleSearchConsole] access token refresh persist failed", {
      code: error.code,
      message: error.message,
    });
  }
}

export async function markNeedsReauth(organizationId: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("google_connections")
    .update({ needs_reauth: true, updated_at: new Date().toISOString() })
    .eq("organization_id", organizationId);

  if (error) {
    console.error("[googleSearchConsole] failed to mark connection needs_reauth", {
      code: error.code,
      message: error.message,
    });
  }
}
