import { getGoogleOAuthEnv, GOOGLE_SEARCH_CONSOLE_SCOPE } from "./config";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * The URL to send the user to for Google's consent screen.
 * `access_type=offline` requests a refresh token; `prompt=consent` forces
 * Google to issue one even if this account already granted the scope
 * before (Google otherwise only returns a refresh token on the very first
 * consent), which matters here since MARKO must be able to refresh access
 * server-side indefinitely, not just for one session.
 */
export function buildGoogleAuthorizationUrl(state: string): string {
  const env = getGoogleOAuthEnv();
  const params = new URLSearchParams({
    client_id: env.clientId,
    redirect_uri: env.redirectUri,
    response_type: "code",
    scope: GOOGLE_SEARCH_CONSOLE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTHORIZATION_ENDPOINT}?${params.toString()}`;
}

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

type TokenEndpointResult =
  | { ok: true; payload: Required<Pick<GoogleTokenResponse, "access_token">> & GoogleTokenResponse }
  | { ok: false; errorCode: string | null; error: string };

/** Never logs or returns the request body (which carries the refresh
 * token / authorization code / client secret) — only Google's own
 * error/error_description fields, which describe the failure, not the
 * credentials involved. */
async function postToTokenEndpoint(body: URLSearchParams): Promise<TokenEndpointResult> {
  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    return { ok: false, errorCode: null, error: "Could not reach Google's token endpoint." };
  }

  let payload: GoogleTokenResponse;
  try {
    payload = (await response.json()) as GoogleTokenResponse;
  } catch {
    return { ok: false, errorCode: null, error: "Google's token endpoint returned an unreadable response." };
  }

  if (!response.ok || !payload.access_token) {
    return {
      ok: false,
      errorCode: payload.error ?? null,
      error: payload.error_description ?? payload.error ?? `Google returned HTTP ${response.status}.`,
    };
  }

  return { ok: true, payload: { ...payload, access_token: payload.access_token } };
}

export type TokenExchangeResult =
  | {
      ok: true;
      accessToken: string;
      refreshToken: string | null;
      expiresInSeconds: number;
      scope: string;
    }
  | { ok: false; error: string };

/** Exchanges an authorization `code` (from the OAuth callback) for an
 * access token and (usually, given `prompt=consent` above) a refresh
 * token. */
export async function exchangeCodeForTokens(code: string): Promise<TokenExchangeResult> {
  const env = getGoogleOAuthEnv();
  const result = await postToTokenEndpoint(
    new URLSearchParams({
      code,
      client_id: env.clientId,
      client_secret: env.clientSecret,
      redirect_uri: env.redirectUri,
      grant_type: "authorization_code",
    }),
  );

  if (!result.ok) return { ok: false, error: result.error };

  return {
    ok: true,
    accessToken: result.payload.access_token,
    refreshToken: result.payload.refresh_token ?? null,
    expiresInSeconds: result.payload.expires_in ?? 3600,
    scope: result.payload.scope ?? GOOGLE_SEARCH_CONSOLE_SCOPE,
  };
}

export type RefreshTokenResult =
  | { ok: true; accessToken: string; expiresInSeconds: number }
  | { ok: false; needsReauth: boolean; error: string };

/**
 * Exchanges a stored refresh token for a new access token. Google's
 * documented error code for a revoked/expired/invalidated refresh token is
 * `invalid_grant` — the one failure mode that means the connection needs
 * the user to reconnect, as opposed to a transient network/server error
 * worth just trying again later.
 */
export async function refreshAccessToken(refreshToken: string): Promise<RefreshTokenResult> {
  const env = getGoogleOAuthEnv();
  const result = await postToTokenEndpoint(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.clientId,
      client_secret: env.clientSecret,
      grant_type: "refresh_token",
    }),
  );

  if (result.ok) {
    return {
      ok: true,
      accessToken: result.payload.access_token,
      expiresInSeconds: result.payload.expires_in ?? 3600,
    };
  }

  return { ok: false, needsReauth: result.errorCode === "invalid_grant", error: result.error };
}
