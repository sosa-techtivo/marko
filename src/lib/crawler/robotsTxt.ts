import { assertSafeToFetch } from "./ssrfGuard";

const FETCH_TIMEOUT_MS = 8_000;
const MAX_BODY_BYTES = 500_000; // robots.txt files are small; this is a defensive cap only
const USER_AGENT = "MarkoBot/0.1 (+SEO audit of your own site; manual crawl)";

/** The user-agent token MARKO evaluates blocking rules against. Google's own
 * crawler token is used as the baseline "can this be indexed at all" signal
 * — the most conservative, widely-applicable choice for an SEO audit. */
const EVALUATED_USER_AGENT = "googlebot";

type RobotsDirective = { type: "allow" | "disallow"; path: string };

export type RobotsGroup = {
  userAgents: string[];
  directives: RobotsDirective[];
};

/**
 * Evidence from attempting to fetch and parse a site's robots.txt.
 *
 * `group` is the single source of truth callers act on: it is non-null ONLY
 * when a rule set was confidently parsed and applies to `googlebot`. Every
 * inconclusive case — missing file, network/timeout failure, a non-200/404
 * status, a redirect, or a body with no applicable group — collapses to
 * `group: null`. Callers must never infer blocking from `status` or
 * `fetchError` directly; the single rule is "no group, never block," which
 * keeps false positives structurally impossible regardless of how many
 * inconclusive cases exist.
 */
export type RobotsTxtEvidence = {
  /** HTTP status of the robots.txt fetch itself, or null if the request
   * never completed (SSRF rejection, network error, timeout, invalid URL). */
  status: number | null;
  /** Human-readable reason when `status`/`group` don't tell the full story
   * (e.g. a network error, or "no applicable group"). Null on a normal 200
   * or a normal 404 (both are fully conclusive on their own). */
  fetchError: string | null;
  group: RobotsGroup | null;
};

function evidence(status: number | null, fetchError: string | null): RobotsTxtEvidence {
  return { status, fetchError, group: null };
}

/**
 * Parses robots.txt content into user-agent groups, per the standard
 * grouping rule: consecutive `User-agent` lines share one group; a group
 * ends as soon as a directive line is seen and the next `User-agent` line
 * starts a new group. Unknown fields (Sitemap, Crawl-delay, comments) are
 * ignored — only Allow/Disallow are relevant to blocking detection.
 */
export function parseRobotsTxt(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let sawDirectiveSinceUserAgent = false;

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;

    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const field = line.slice(0, colonIndex).trim().toLowerCase();
    const value = line.slice(colonIndex + 1).trim();

    if (field === "user-agent") {
      if (!current || sawDirectiveSinceUserAgent) {
        current = { userAgents: [], directives: [] };
        groups.push(current);
        sawDirectiveSinceUserAgent = false;
      }
      current.userAgents.push(value.toLowerCase());
      continue;
    }

    if (field === "allow" || field === "disallow") {
      if (!current) continue; // directive with no preceding User-agent: not a valid group, ignore
      sawDirectiveSinceUserAgent = true;
      current.directives.push({ type: field, path: value });
      continue;
    }
  }

  return groups;
}

/**
 * Selects the group that applies to `userAgentToken`, per spec precedence
 * and merging rules: every group whose user-agent list matches
 * `userAgentToken` (or, if none, every group matching `*`) is combined into
 * one merged rule set — real robots.txt files not infrequently repeat
 * `User-agent: *` more than once (e.g. a plugin-generated block appended
 * after a hand-written one), and per spec those are one logical group, not
 * independent ones where only the first is honored. An explicit, matching
 * group still fully overrides `*` (never merged together WITH `*` — only
 * with other groups sharing the same token). Returns null when nothing
 * matches at all.
 */
export function selectApplicableGroup(
  groups: RobotsGroup[],
  userAgentToken: string,
): RobotsGroup | null {
  const token = userAgentToken.toLowerCase();
  const specific = groups.filter((group) => group.userAgents.includes(token));
  if (specific.length > 0) return mergeGroups(specific);
  const wildcard = groups.filter((group) => group.userAgents.includes("*"));
  return wildcard.length > 0 ? mergeGroups(wildcard) : null;
}

function mergeGroups(groups: RobotsGroup[]): RobotsGroup {
  return {
    userAgents: [...new Set(groups.flatMap((group) => group.userAgents))],
    directives: groups.flatMap((group) => group.directives),
  };
}

function patternToRegExp(pattern: string): RegExp {
  const endAnchored = pattern.endsWith("$");
  const body = endAnchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}${endAnchored ? "$" : ""}`);
}

/**
 * Longest-matching-prefix-wins, per the de facto robots.txt spec: whichever
 * Allow/Disallow rule has the longest matched path pattern applies; a tie
 * resolves to Allow (the less restrictive outcome). An empty Disallow value
 * ("Disallow:") means "nothing disallowed" and is skipped entirely, rather
 * than matching every path as an empty-prefix.
 */
export function isPathBlocked(group: RobotsGroup, path: string): boolean {
  let best: { type: "allow" | "disallow"; length: number } | null = null;

  for (const directive of group.directives) {
    if (!directive.path) continue;
    if (!patternToRegExp(directive.path).test(path)) continue;

    const length = directive.path.length;
    if (!best || length > best.length || (length === best.length && directive.type === "allow")) {
      best = { type: directive.type, length };
    }
  }

  return best?.type === "disallow";
}

/**
 * Fetches and parses the site's robots.txt once per crawl. Never follows
 * redirects (a deliberate simplification: any 3xx response is treated as
 * inconclusive, `group: null`) — this trades a rare false-negative (a
 * redirected robots.txt that would have revealed real blocking rules) for
 * zero false-positive risk and avoids duplicating fetchPage's redirect
 * logic for a single, small, non-content file.
 */
export async function fetchRobotsTxt(siteUrl: string): Promise<RobotsTxtEvidence> {
  let robotsUrl: URL;
  try {
    robotsUrl = new URL("/robots.txt", siteUrl);
  } catch {
    return evidence(null, "Site URL is not valid.");
  }

  const safety = await assertSafeToFetch(robotsUrl);
  if (!safety.ok) {
    return evidence(null, safety.reason);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(robotsUrl.toString(), {
      signal: controller.signal,
      redirect: "manual",
      headers: { "User-Agent": USER_AGENT, Accept: "text/plain" },
    });

    // A missing robots.txt is a fully conclusive, standard signal: nothing
    // is disallowed. `group: null` already means "never block," so this is
    // correct without needing a synthetic "allow all" group.
    if (response.status === 404) {
      return { status: 404, fetchError: null, group: null };
    }

    if (response.status !== 200) {
      return evidence(response.status, `robots.txt returned status ${response.status}.`);
    }

    const buffer = await response.arrayBuffer();
    const truncated = buffer.byteLength > MAX_BODY_BYTES ? buffer.slice(0, MAX_BODY_BYTES) : buffer;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(truncated);

    const groups = parseRobotsTxt(text);
    const group = selectApplicableGroup(groups, EVALUATED_USER_AGENT);

    return {
      status: 200,
      fetchError: group ? null : "robots.txt has no rules applicable to this crawl.",
      group,
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? `Timed out after ${FETCH_TIMEOUT_MS / 1000}s`
          : err.message
        : "Unknown fetch error";
    return evidence(null, message);
  } finally {
    clearTimeout(timeout);
  }
}
