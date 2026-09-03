/** Read-only Search Console scope — the narrowest scope that grants access
 * to a site's Search Console performance data; excludes write access
 * (`.../auth/webmasters`) and any non-Search-Console scope (no email/
 * profile — MARKO doesn't need to know the connected account's identity,
 * only its Search Console access). */
export const GOOGLE_SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export type GoogleOAuthEnv = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

/** Throws with a clear message if any required Google OAuth env var is
 * missing — only called at request time (from a Route Handler/Server
 * Action), never at module load, so the app still builds/runs for
 * unrelated pages without these set. See .env.example. */
export function getGoogleOAuthEnv(): GoogleOAuthEnv {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Google Search Console is not configured: set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REDIRECT_URI (see .env.example).",
    );
  }

  return { clientId, clientSecret, redirectUri };
}
