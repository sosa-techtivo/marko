/**
 * Minimal, dependency-free HTML extraction for the SEO crawl slice.
 * Deliberately regex-based rather than a full DOM parser: we only need a
 * handful of well-known tags/attributes, not general HTML rendering.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const isHex = entity[1] === "x" || entity[1] === "X";
      const code = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

function cleanText(raw: string): string | null {
  const text = decodeHtmlEntities(stripTags(raw)).replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

function getAttr(tag: string, attr: string): string | null {
  const re = new RegExp(`\\b${attr}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const match = tag.match(re);
  if (!match) return null;
  return decodeHtmlEntities((match[2] ?? match[3] ?? match[4] ?? "").trim());
}

export function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? cleanText(match[1]) : null;
}

export function extractFirstH1(html: string): string | null {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return match ? cleanText(match[1]) : null;
}

function findTags(html: string, tagName: string): string[] {
  return html.match(new RegExp(`<${tagName}\\b[^>]*>`, "gi")) ?? [];
}

export function extractMetaContent(html: string, name: string): string | null {
  for (const tag of findTags(html, "meta")) {
    const tagName = getAttr(tag, "name");
    if (tagName && tagName.toLowerCase() === name.toLowerCase()) {
      const content = getAttr(tag, "content");
      return content && content.trim().length > 0 ? content.trim() : null;
    }
  }
  return null;
}

export function extractCanonical(html: string): string | null {
  for (const tag of findTags(html, "link")) {
    const rel = getAttr(tag, "rel");
    if (rel && rel.toLowerCase().split(/\s+/).includes("canonical")) {
      return getAttr(tag, "href");
    }
  }
  return null;
}

export function extractLinkHrefs(html: string): string[] {
  const hrefs: string[] = [];
  for (const tag of findTags(html, "a")) {
    const href = getAttr(tag, "href");
    if (href) hrefs.push(href);
  }
  return hrefs;
}
