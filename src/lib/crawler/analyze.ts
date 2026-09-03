import type { FetchedPage } from "./fetchPage";
import type { ExtractedImage } from "./html";
import {
  META_DESCRIPTION_MAX_LENGTH,
  META_DESCRIPTION_MIN_LENGTH,
  TITLE_MAX_LENGTH,
  TITLE_MIN_LENGTH,
} from "./seoRules";

export type CrawlIssueType =
  | "http_error"
  | "missing_title"
  | "title_too_short"
  | "title_too_long"
  | "duplicate_title"
  | "missing_meta_description"
  | "meta_description_too_short"
  | "meta_description_too_long"
  | "duplicate_meta_description"
  | "missing_h1"
  | "multiple_h1"
  | "non_indexable"
  | "invalid_canonical"
  | "missing_canonical"
  | "duplicate_canonical"
  | "canonical_chain"
  | "images_missing_alt"
  | "invalid_structured_data";

export type CrawlIssueSeverity = "warning" | "critical";

export type CrawlIssue = {
  type: CrawlIssueType;
  severity: CrawlIssueSeverity;
  message: string;
};

export type AnalyzedPage = {
  url: string;
  httpStatus: number | null;
  title: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  h1: string | null;
  isIndexable: boolean;
  robotsDirectives: string | null;
  internalLinkCount: number;
  fetchError: string | null;
  issues: CrawlIssue[];
};

/**
 * Resolves a raw canonical href (as found in the HTML, possibly relative)
 * against the page's own URL, and flags it if it's empty, unparsable, or
 * points at a different host than the page itself.
 */
function resolveCanonical(
  rawHref: string | null,
  pageUrl: string,
): { resolved: string | null; issue: string | null } {
  if (rawHref === null) {
    return { resolved: null, issue: null };
  }

  const trimmed = rawHref.trim();
  if (trimmed.length === 0) {
    return {
      resolved: null,
      issue:
        "This page has an empty canonical tag, which search engines will ignore or may misinterpret.",
    };
  }

  try {
    const absolute = new URL(trimmed, pageUrl);
    const pageHostname = new URL(pageUrl).hostname;
    if (absolute.hostname !== pageHostname) {
      return {
        resolved: absolute.toString(),
        issue: `This page's canonical tag points to a different domain (${absolute.hostname}), telling search engines this content belongs elsewhere.`,
      };
    }
    return { resolved: absolute.toString(), issue: null };
  } catch {
    return {
      resolved: trimmed,
      issue: "This page's canonical tag is not a valid URL.",
    };
  }
}

// A common, deterministic tracking-pixel signature: an explicitly
// declared 1x1-or-smaller image. These carry no visual/semantic content,
// so a missing `alt` on one is expected, not a finding — unlike an
// arbitrary "small" image, which could still be meaningful (an icon,
// a small photo), this is narrow enough to avoid guessing.
const DECORATIVE_MAX_DIMENSION_PX = 1;

/**
 * Whether an image with no `alt` attribute is expected to lack one —
 * i.e. explicitly marked decorative/hidden by structural HTML signals
 * alone (never a visual/AI judgment about the image's actual content).
 * Only called for images where `hasAlt` is already false — an `alt=""`
 * is its own, separate "intentionally decorative" signal handled by the
 * caller, not by this function.
 */
function isStructurallyDecorative(image: ExtractedImage): boolean {
  const role = image.role?.trim().toLowerCase();
  if (role === "presentation" || role === "none") return true;
  if (image.ariaHidden?.trim().toLowerCase() === "true") return true;

  const width = image.width !== null ? Number(image.width) : null;
  const height = image.height !== null ? Number(image.height) : null;
  if (
    width !== null &&
    height !== null &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width <= DECORATIVE_MAX_DIMENSION_PX &&
    height <= DECORATIVE_MAX_DIMENSION_PX
  ) {
    return true;
  }

  return false;
}

/**
 * A JSON-LD script block is usable if it's non-empty, parses as JSON, and
 * the parsed result is an object or array (the only shapes JSON-LD can
 * legally take) — deliberately nothing further: no `@context`/`@type`
 * presence check, no Schema.org vocabulary/shape validation.
 */
function isParsableJsonLd(rawContent: string): boolean {
  const trimmed = rawContent.trim();
  if (trimmed.length === 0) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}

export function analyzePage(params: {
  url: string;
  fetched: FetchedPage;
  title: string | null;
  metaDescription: string | null;
  metaRobots: string | null;
  rawCanonicalHref: string | null;
  h1: string | null;
  h1Count: number;
  internalLinkCount: number;
  images: ExtractedImage[];
  jsonLdBlocks: string[];
}): AnalyzedPage {
  const {
    url,
    fetched,
    title,
    metaDescription,
    metaRobots,
    rawCanonicalHref,
    h1,
    h1Count,
    internalLinkCount,
    images,
    jsonLdBlocks,
  } = params;

  const issues: CrawlIssue[] = [];
  const httpStatus = fetched.status;
  const fetchFailed = fetched.error !== null;
  const isSuccessStatus = httpStatus !== null && httpStatus >= 200 && httpStatus < 300;

  // A confirmed bot-protection challenge (see fetchPage.ts) is not an SEO
  // finding: MARKO only knows its own crawler was blocked, not that users
  // or search engines can't reach the page, so no http_error is raised for
  // it here. (For the crawl's seed page specifically, runCrawl.ts fails
  // the whole run before analyzePage is ever called — see there.)
  if ((fetchFailed || !isSuccessStatus) && !fetched.botProtectionBlocked) {
    issues.push({
      type: "http_error",
      severity: "critical",
      message: fetchFailed
        ? `The page could not be fetched (${fetched.error}).`
        : `The page returned HTTP status ${httpStatus}, so it cannot be indexed normally.`,
    });
  }

  const robotsDirectives = [metaRobots, fetched.xRobotsTag].filter(Boolean).join("; ") || null;
  const isNoindex = /noindex/i.test(robotsDirectives ?? "");
  const isIndexable = isSuccessStatus && !isNoindex;

  const { resolved: canonicalUrl, issue: canonicalIssue } = isSuccessStatus
    ? resolveCanonical(rawCanonicalHref, url)
    : { resolved: null, issue: null };

  if (isSuccessStatus) {
    if (!title) {
      issues.push({
        type: "missing_title",
        severity: "critical",
        message:
          "This page has no <title> tag. Search engines use it as the primary link text in results — add a unique, descriptive title.",
      });
    } else if (title.length < TITLE_MIN_LENGTH) {
      issues.push({
        type: "title_too_short",
        severity: "warning",
        message: `This page's title is ${title.length} characters, shorter than the recommended minimum of ${TITLE_MIN_LENGTH}. A brief title may not fully describe the page to search engines and searchers.`,
      });
    } else if (title.length > TITLE_MAX_LENGTH) {
      issues.push({
        type: "title_too_long",
        severity: "warning",
        message: `This page's title is ${title.length} characters, longer than the recommended maximum of ${TITLE_MAX_LENGTH}. Search engines may truncate it in search results.`,
      });
    }

    if (!metaDescription) {
      issues.push({
        type: "missing_meta_description",
        severity: "warning",
        message:
          "This page has no meta description. Add one to control how it's summarized in search results.",
      });
    } else if (metaDescription.length < META_DESCRIPTION_MIN_LENGTH) {
      issues.push({
        type: "meta_description_too_short",
        severity: "warning",
        message: `This page's meta description is ${metaDescription.length} characters, shorter than the recommended minimum of ${META_DESCRIPTION_MIN_LENGTH}.`,
      });
    } else if (metaDescription.length > META_DESCRIPTION_MAX_LENGTH) {
      issues.push({
        type: "meta_description_too_long",
        severity: "warning",
        message: `This page's meta description is ${metaDescription.length} characters, longer than the recommended maximum of ${META_DESCRIPTION_MAX_LENGTH}. Search engines may truncate it in search results.`,
      });
    }

    if (!h1) {
      issues.push({
        type: "missing_h1",
        severity: "warning",
        message: "This page has no <h1> heading. Add one to signal the page's main topic clearly.",
      });
    }

    if (h1Count > 1) {
      issues.push({
        type: "multiple_h1",
        severity: "warning",
        message: `This page has ${h1Count} <h1> headings. Using more than one can make it unclear which heading represents the page's main topic.`,
      });
    }

    if (isNoindex) {
      issues.push({
        type: "non_indexable",
        severity: "critical",
        message: `This page is marked noindex (${robotsDirectives}), so it will not appear in search results.`,
      });
    }

    if (canonicalIssue) {
      issues.push({ type: "invalid_canonical", severity: "warning", message: canonicalIssue });
    } else if (rawCanonicalHref === null) {
      issues.push({
        type: "missing_canonical",
        severity: "warning",
        message:
          "This page has no canonical tag. Without one, search engines must infer the authoritative URL themselves, which matters if this page is reachable through more than one URL.",
      });
    }

    // One finding per page, not one per image: `alt=""` is treated as a
    // deliberate "this image is decorative" signal (never flagged), and a
    // missing `alt` is only counted against a "meaningful" image —
    // structurally decorative ones (role="presentation"/"none",
    // aria-hidden="true", or a declared ~1x1 tracking-pixel size) are
    // excluded rather than blindly flagging every <img>.
    const meaningfulMissingAltCount = images.filter(
      (image) => !image.hasAlt && !isStructurallyDecorative(image),
    ).length;
    if (meaningfulMissingAltCount > 0) {
      issues.push({
        type: "images_missing_alt",
        severity: "warning",
        message: `${meaningfulMissingAltCount} image${meaningfulMissingAltCount === 1 ? "" : "s"} on this page ${meaningfulMissingAltCount === 1 ? "is" : "are"} missing alt text. (Images with alt="" are treated as intentionally decorative and are not counted here.)`,
      });
    }

    // Same one-per-page grouping for structured data: a page with several
    // JSON-LD blocks and one broken one gets a single finding naming how
    // many are affected, not one card per script tag.
    const invalidJsonLdCount = jsonLdBlocks.filter((block) => !isParsableJsonLd(block)).length;
    if (invalidJsonLdCount > 0) {
      issues.push({
        type: "invalid_structured_data",
        severity: "warning",
        message: `${invalidJsonLdCount} of ${jsonLdBlocks.length} structured data (JSON-LD) block${jsonLdBlocks.length === 1 ? "" : "s"} on this page could not be parsed as valid JSON.`,
      });
    }
  }

  return {
    url,
    httpStatus,
    title,
    metaDescription,
    canonicalUrl,
    h1,
    isIndexable,
    robotsDirectives,
    internalLinkCount,
    fetchError: fetched.error,
    issues,
  };
}
