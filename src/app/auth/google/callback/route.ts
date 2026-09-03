import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUserAndOrganization } from "@/lib/organizations";
import { exchangeCodeForTokens } from "@/lib/googleSearchConsole/oauthClient";
import { upsertConnection } from "@/lib/googleSearchConsole/connectionStore";
import {
  isSafeInternalPath,
  isValidOAuthState,
  OAUTH_RETURN_TO_COOKIE,
  OAUTH_STATE_COOKIE,
} from "@/lib/googleSearchConsole/oauthState";

function withError(path: string, error: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}error=${error}`;
}

export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url);
  const cookieStore = await cookies();

  const expectedState = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  const returnToCookie = cookieStore.get(OAUTH_RETURN_TO_COOKIE)?.value;
  const returnTo = returnToCookie && isSafeInternalPath(returnToCookie) ? returnToCookie : "/dashboard";

  // One-shot cookies — cleared as soon as they're read, regardless of how
  // this request turns out, so a replayed callback URL can never succeed.
  cookieStore.delete(OAUTH_STATE_COOKIE);
  cookieStore.delete(OAUTH_RETURN_TO_COOKIE);

  const googleError = searchParams.get("error");
  if (googleError) {
    // The user declined consent, or Google reported its own error — not a
    // CSRF/security concern, just a normal "didn't connect" outcome.
    return NextResponse.redirect(`${origin}${withError(returnTo, "google-oauth-denied")}`);
  }

  const receivedState = searchParams.get("state");
  const code = searchParams.get("code");
  if (!isValidOAuthState(expectedState, receivedState) || !code) {
    console.error("[googleSearchConsole] OAuth callback state mismatch or missing code");
    return NextResponse.redirect(`${origin}${withError(returnTo, "google-oauth-invalid-state")}`);
  }

  const { user, organization } = await requireUserAndOrganization();
  if (!organization) {
    return NextResponse.redirect(`${origin}/dashboard`);
  }

  const tokenResult = await exchangeCodeForTokens(code);
  if (!tokenResult.ok) {
    console.error("[googleSearchConsole] token exchange failed", { error: tokenResult.error });
    return NextResponse.redirect(`${origin}${withError(returnTo, "google-oauth-token-exchange-failed")}`);
  }

  const stored = await upsertConnection({
    organizationId: organization.id,
    connectedBy: user.id,
    refreshToken: tokenResult.refreshToken,
    accessToken: tokenResult.accessToken,
    accessTokenExpiresAt: new Date(Date.now() + tokenResult.expiresInSeconds * 1000).toISOString(),
    scope: tokenResult.scope,
  });

  if (!stored.ok) {
    return NextResponse.redirect(`${origin}${withError(returnTo, "google-oauth-save-failed")}`);
  }

  return NextResponse.redirect(`${origin}${returnTo}`);
}
