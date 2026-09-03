import { randomBytes, timingSafeEqual } from "node:crypto";

const STATE_BYTES = 32;

/** Cookie names shared by the connect and callback route handlers. Short
 * lifetime (see COOKIE_MAX_AGE_SECONDS), httpOnly, and cleared by the
 * callback route regardless of outcome — this is one-shot CSRF state, not
 * a long-lived session. */
export const OAUTH_STATE_COOKIE = "gsc_oauth_state";
export const OAUTH_RETURN_TO_COOKIE = "gsc_oauth_return_to";
export const OAUTH_COOKIE_MAX_AGE_SECONDS = 600;

/** A fresh, unguessable CSRF token for one OAuth round trip. Stored in an
 * httpOnly cookie by the connect route and compared against the `state`
 * query param Google echoes back to the callback route. */
export function generateOAuthState(): string {
  return randomBytes(STATE_BYTES).toString("hex");
}

/** Constant-time comparison so a timing side-channel can't help an
 * attacker guess the expected state value. Rejects anything missing,
 * empty, or the wrong length before ever calling timingSafeEqual (which
 * throws on mismatched buffer lengths). */
export function isValidOAuthState(
  expected: string | null | undefined,
  received: string | null | undefined,
): boolean {
  if (!expected || !received) return false;

  const expectedBuf = Buffer.from(expected);
  const receivedBuf = Buffer.from(received);
  if (expectedBuf.length !== receivedBuf.length) return false;

  return timingSafeEqual(expectedBuf, receivedBuf);
}

/** Only ever used for a post-connect redirect target we ourselves set in a
 * cookie — validated anyway, defensively, since it ends up in a
 * server-issued redirect. Rejects anything that isn't an unambiguous
 * same-origin path (no scheme, no protocol-relative "//", no backslash —
 * some browsers treat "\" as "/", which could otherwise smuggle a
 * protocol-relative external URL past a naive leading-slash check). */
export function isSafeInternalPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("\\");
}
