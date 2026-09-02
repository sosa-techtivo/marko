/**
 * Shared vocabulary for "MARKO's crawler was blocked by bot protection"
 * failures. A confirmed bot-protection block (e.g. a Cloudflare Managed
 * Challenge) is explicitly NOT an SEO finding: MARKO only knows its own
 * crawler was denied, not that users or search engines can't reach the
 * page. See PROJECT_STATUS.md for the boyaca.gov.co diagnosis this is
 * based on.
 *
 * `formatBotProtectionErrorMessage` builds the crawl_runs.error_message at
 * crawl time (runCrawl.ts); `isBotProtectionFailureMessage` recognizes
 * that same message later at render time (the site detail page) to show a
 * neutral "Analysis blocked" state instead of a generic failure banner.
 * Deliberately a stable substring check on the persisted message rather
 * than a new column: this is a display-time distinction, not structured
 * data anything else needs to query or join on.
 */
const BOT_PROTECTION_MARKER = "its bot protection blocked the crawler";

export function formatBotProtectionErrorMessage(status: number | null): string {
  const statusPart = status !== null ? ` (HTTP ${status})` : "";
  return `MARKO could not analyze this site because ${BOT_PROTECTION_MARKER}${statusPart}. This does not necessarily mean the site is unavailable to users or search engines.`;
}

export function isBotProtectionFailureMessage(message: string | null | undefined): boolean {
  return !!message && message.includes(BOT_PROTECTION_MARKER);
}
