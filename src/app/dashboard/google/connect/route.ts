import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUserAndOrganization } from "@/lib/organizations";
import { buildGoogleAuthorizationUrl } from "@/lib/googleSearchConsole/oauthClient";
import {
  generateOAuthState,
  isSafeInternalPath,
  OAUTH_COOKIE_MAX_AGE_SECONDS,
  OAUTH_RETURN_TO_COOKIE,
  OAUTH_STATE_COOKIE,
} from "@/lib/googleSearchConsole/oauthState";

/**
 * Starts the Search Console OAuth flow. The connection belongs to the
 * caller's organization (requireUserAndOrganization redirects to /login if
 * unauthenticated), not to the specific site the request came from — an
 * optional `?returnTo=` brings the user back to whichever site detail page
 * they started from.
 */
export async function GET(request: Request) {
  const { organization } = await requireUserAndOrganization();
  if (!organization) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  const { searchParams } = new URL(request.url);
  const returnToParam = searchParams.get("returnTo");
  const returnTo = returnToParam && isSafeInternalPath(returnToParam) ? returnToParam : "/dashboard";

  const state = generateOAuthState();
  const cookieStore = await cookies();
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS,
  };
  cookieStore.set(OAUTH_STATE_COOKIE, state, cookieOptions);
  cookieStore.set(OAUTH_RETURN_TO_COOKIE, returnTo, cookieOptions);

  return NextResponse.redirect(buildGoogleAuthorizationUrl(state));
}
