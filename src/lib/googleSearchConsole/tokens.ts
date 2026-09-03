import { getConnectionRecord, markNeedsReauth, updateAccessToken } from "./connectionStore";
import { refreshAccessToken } from "./oauthClient";

/** Refresh proactively this long before the stored expiry, so a request
 * never races a token that's about to expire mid-flight. */
const EXPIRY_BUFFER_MS = 60_000;

export type AccessTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; reason: "not_connected" | "needs_reauth" | "refresh_failed" };

/**
 * The one function every Search Console API call goes through to get a
 * usable access token: reuses the stored one if it's still fresh,
 * otherwise refreshes it server-side via the stored refresh token. Never
 * throws, and never returns a token when the connection needs
 * re-authentication — callers get a typed reason instead, so the UI can
 * show "Reconnect required" rather than a generic failure. `organizationId`
 * must already be verified to belong to the requesting user by the
 * caller.
 */
export async function getValidAccessToken(organizationId: string): Promise<AccessTokenResult> {
  const connection = await getConnectionRecord(organizationId);
  if (!connection) return { ok: false, reason: "not_connected" };
  if (connection.needsReauth) return { ok: false, reason: "needs_reauth" };

  const expiresAtMs = connection.accessTokenExpiresAt ? Date.parse(connection.accessTokenExpiresAt) : NaN;
  const stillValid =
    connection.accessToken !== null &&
    Number.isFinite(expiresAtMs) &&
    expiresAtMs - Date.now() > EXPIRY_BUFFER_MS;

  if (stillValid && connection.accessToken) {
    return { ok: true, accessToken: connection.accessToken };
  }

  const refreshed = await refreshAccessToken(connection.refreshToken);
  if (!refreshed.ok) {
    if (refreshed.needsReauth) {
      await markNeedsReauth(organizationId);
      return { ok: false, reason: "needs_reauth" };
    }
    console.error("[googleSearchConsole] access token refresh failed", { error: refreshed.error });
    return { ok: false, reason: "refresh_failed" };
  }

  const accessTokenExpiresAt = new Date(Date.now() + refreshed.expiresInSeconds * 1000).toISOString();
  await updateAccessToken({ organizationId, accessToken: refreshed.accessToken, accessTokenExpiresAt });

  return { ok: true, accessToken: refreshed.accessToken };
}
