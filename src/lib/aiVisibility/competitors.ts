import { normalizeHostname } from "./domain";

/**
 * Deterministic competitor extraction for an AI Visibility result: the
 * companies a chatbot presented as options in its answer, excluding the
 * client itself. Not MARKO's Competitive Intelligence feature — no
 * configured competitor list, no scoring, no AI call. Derived at read time
 * from the evidence already persisted with each result (raw_response's
 * answerHtml for Browser results; the markdown answer text otherwise), so
 * historical runs get the same treatment without a migration.
 *
 * Only structural signals the chatbots use for "this is a company" count;
 * when an item can't be confirmed as a company it is omitted rather than
 * guessed:
 *   - a list item that starts with a bold name followed by a separator —
 *     "**Leanware** (Bogotá) – …", "**Bolder Apps** — …";
 *   - a list item that starts with a bold "Name:" followed by a
 *     noun-phrase description ("**Simform:** A comprehensive …") — labels
 *     such as "**Core Expertise:** They focus …" read as sentences and are
 *     skipped;
 *   - a list item that is only a bold "Name (City):" heading its own
 *     nested list ("**Ceiba Software (Medellín):**" → "Best for: …");
 *   - the first column of a table whose header names companies;
 *   - Gemini business cards (rich-list-card titles);
 *   - ChatGPT company/local-business entities and the map businesses the
 *     model itself chose (isModelPreferred).
 */

export type CompetitorClientIdentity = {
  /** The site's business name — the same value Mentioned matches. */
  brandName: string;
  siteUrl: string;
};

type Candidate = { name: string; position: number };

const MAX_NAME_LENGTH = 60;
const MAX_NAME_WORDS = 7;

/** Generic UI/label text that is never a company on its own. */
const GENERIC_NAMES = new Set([
  "company",
  "companies",
  "software company",
  "software development company",
  "services",
  "open",
  "closed",
  "website",
  "directions",
  "call",
  "sources",
  "reviews",
  "rating",
  "recommendation",
  "recommendations",
  "summary",
  "overview",
  "note",
  "notes",
  "best for",
  "why",
  "pros",
  "cons",
]);

/** Table header (first column) text that marks a company column. */
const COMPANY_HEADER_PATTERN = /^(company|companies|firm|firms|provider|providers|agency|agencies|vendor|vendors|partner|partners|studio|name|developer|developers)\b/i;

/** "Name:" items count only when the description after the colon opens as
 * a noun phrase about the company. */
const COMPANY_DESCRIPTION_OPENING = /^\s*(a|an|the)\s/i;

/** An inline citation link's text: a number, a lowercase domain, or a
 * lowercase source name with a "+N" count. Company names are capitalized,
 * so they never match. */
const CITATION_MARKER = /^\s*(\d+|[a-z0-9-]+(\.[a-z0-9-]+)*(\s*\+\s*\d+)?)\s*$/;

/** After a bold name: "(City)", an en/em dash or hyphen, or a comma. */
const NAME_SEPARATOR_AFTER = /^\s*(\(|[–—]|-\s|,)/;

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * Removes citation chips and other non-answer UI from captured HTML before
 * structural parsing: Gemini source chips/footnotes, ChatGPT grouped-source
 * chips, and a link reference's domain detail. Buttons never nest, so
 * removing a whole chip button by regex is safe. Inline citation links
 * (Perplexity's "1" / "clutch.co" / "clutch+2" markers) are removed too;
 * a link whose text reads like a name is kept.
 */
function stripChrome(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<button\b[^>]*aria-label="View source details[\s\S]*?<\/button>/g, "")
    .replace(/<button\b[^>]*data-assistant-grouped-webpages-trigger[\s\S]*?<\/button>/g, "")
    .replace(/<sup\b[\s\S]*?<\/sup>/g, "")
    .replace(/<span\b[^>]*data-assistant-reference-detail[^>]*>[\s\S]*?<\/span>/g, "")
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/g, (anchor, inner: string) => (CITATION_MARKER.test(stripTags(inner)) ? "" : anchor));
}

/** Business listings often carry a tagline ("BairesDev - Nearshore …",
 * "Bolder Apps | Top Mobile App Developers in Miami") or a category prefix
 * ("Software Company LARS"); keep the business name itself. */
export function cleanCompanyName(raw: string): string {
  let name = decodeEntities(raw).replace(/\s+/g, " ").trim();
  name = name.split(/\s+[|–—-]\s+/)[0].trim();
  name = name.replace(/\s*\([^)]*\)\s*:?$/, "").trim();
  const withoutPrefix = name.replace(/^(software\s+development\s+company|software\s+company|software\s+development)\s+/i, "");
  if (withoutPrefix !== "") name = withoutPrefix;
  return name.replace(/[\s:;,.–—-]+$/, "").trim();
}

/** "PSL/Perficient Latin America" names two companies; split only when
 * every part is itself a plausible name. */
function splitJoinedNames(name: string): string[] {
  if (!name.includes("/")) return [name];
  const parts = name.split(/\s*\/\s*/).map((part) => part.trim());
  return parts.every((part) => isPlausibleCompanyName(part)) ? parts : [name];
}

function companyKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isPlausibleCompanyName(name: string): boolean {
  if (name.length < 2 || name.length > MAX_NAME_LENGTH) return false;
  if (name.split(/\s+/).length > MAX_NAME_WORDS) return false;
  if (!/[A-Za-z]/.test(name) || !/[A-Z0-9]/.test(name)) return false;
  if (/https?:|www\./i.test(name)) return false;
  if (/[.!?]\s+[a-z]/.test(name)) return false;
  return !GENERIC_NAMES.has(companyKey(name));
}

function clientKeys(client: CompetitorClientIdentity): string[] {
  const keys = new Set<string>();
  const brand = companyKey(client.brandName.replace(/\.[a-z]{2,}$/i, ""));
  if (brand.length >= 3) keys.add(brand);
  const host = normalizeHostname(client.siteUrl);
  const label = host?.split(".")[0];
  if (label && label.length >= 3) keys.add(companyKey(label));
  return [...keys];
}

function isClient(name: string, keys: string[]): boolean {
  const key = companyKey(name);
  const compact = key.replace(/\s+/g, "");
  return keys.some((clientKey) => key.includes(clientKey) || compact.includes(clientKey.replace(/\s+/g, "")));
}

function leadingBoldCandidates(html: string): Candidate[] {
  const candidates: Candidate[] = [];
  const itemPattern = /<li\b[^>]*>([\s\S]*?)<\/li>/g;
  for (const item of html.matchAll(itemPattern)) {
    const body = item[1].replace(/^(\s|<p\b[^>]*>|<span\b[^>]*>)*/, "");
    const bold = body.match(/^<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>([\s\S]*)$/);
    if (!bold) continue;
    const label = stripTags(bold[2]);
    const after = stripTags(bold[3]);
    const ownParagraphAfter = stripTags(bold[3].split(/<ul\b|<\/p>/)[0]);
    const headsNestedList = /<ul\b/.test(bold[3]);
    let name: string | null = null;
    if (/\([^)]*\)\s*:$/.test(label) && ownParagraphAfter === "" && headsNestedList) {
      // "**Ceiba Software (Medellín):**" heading its own nested
      // "Best for: … / Overview: …" list.
      name = label.replace(/:$/, "");
    } else if (/:$/.test(label) || /^:/.test(after)) {
      const description = /^:/.test(after) ? after.slice(1) : after;
      if (COMPANY_DESCRIPTION_OPENING.test(description)) name = label.replace(/:$/, "");
    } else if (NAME_SEPARATOR_AFTER.test(after)) {
      name = label;
    }
    if (name) candidates.push({ name, position: item.index ?? 0 });
  }
  return candidates;
}

function tableCandidates(html: string): Candidate[] {
  const candidates: Candidate[] = [];
  for (const table of html.matchAll(/<table\b[\s\S]*?<\/table>/g)) {
    const firstHeader = table[0].match(/<th\b[^>]*>([\s\S]*?)<\/th>/);
    if (!firstHeader || !COMPANY_HEADER_PATTERN.test(stripTags(firstHeader[1]))) continue;
    for (const row of table[0].matchAll(/<tr\b[^>]*>\s*<td\b[^>]*>([\s\S]*?)<\/td>/g)) {
      candidates.push({ name: stripTags(row[1]), position: (table.index ?? 0) + (row.index ?? 0) });
    }
  }
  return candidates;
}

function geminiCardCandidates(html: string): Candidate[] {
  const candidates: Candidate[] = [];
  const cardPattern = /<rich-list-card\b[\s\S]*?<div\b[^>]*>([^<>]{2,160})<\/div>\s*<rich-list-row/g;
  for (const card of html.matchAll(cardPattern)) {
    candidates.push({ name: card[1], position: card.index ?? 0 });
  }
  return candidates;
}

function parseJsonAttribute(value: string): unknown {
  try {
    return JSON.parse(decodeEntities(value));
  } catch {
    return null;
  }
}

function chatGptEntityCandidates(html: string): Candidate[] {
  const candidates: Candidate[] = [];
  for (const match of html.matchAll(/data-assistant-entity-payload="([^"]*)"/g)) {
    const entity = parseJsonAttribute(match[1]) as { query?: unknown; category?: unknown } | null;
    if (typeof entity?.query !== "string") continue;
    if (entity.category !== "company" && entity.category !== "local_business") continue;
    candidates.push({ name: entity.query, position: match.index ?? 0 });
  }
  for (const match of html.matchAll(/data-assistant-map-payload="([^"]*)"/g)) {
    const places = parseJsonAttribute(match[1]);
    if (!Array.isArray(places)) continue;
    for (const place of places as { name?: unknown; isModelPreferred?: unknown }[]) {
      if (typeof place?.name === "string" && place.isModelPreferred === true) {
        candidates.push({ name: place.name, position: match.index ?? 0 });
      }
    }
  }
  return candidates;
}

/** Markdown answers (API results): the same list/table conventions. */
function markdownCandidates(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  let position = 0;
  let companyTable = false;
  for (const line of text.split("\n")) {
    const item = line.match(/^\s*(?:[-*•]|\d+[.)])\s+\*\*(.+?)\*\*(.*)$/);
    if (item) {
      const label = item[1].trim();
      const after = item[2];
      if (/:$/.test(label) || /^:/.test(after)) {
        const description = /^:/.test(after) ? after.slice(1) : after;
        if (COMPANY_DESCRIPTION_OPENING.test(description)) candidates.push({ name: label.replace(/:$/, ""), position });
      } else if (NAME_SEPARATOR_AFTER.test(after)) {
        candidates.push({ name: label, position });
      }
    }
    const cells = line.trim().startsWith("|") ? line.trim().replace(/^\||\|$/g, "").split("|") : null;
    if (!cells) {
      companyTable = false;
    } else if (/^\s*:?-{3,}/.test(cells[0])) {
      // header separator row
    } else if (!companyTable && COMPANY_HEADER_PATTERN.test(cells[0].replace(/\*/g, "").trim())) {
      companyTable = true;
    } else if (companyTable) {
      candidates.push({ name: cells[0].replace(/\*/g, "").trim(), position });
    }
    position += line.length + 1;
  }
  return candidates;
}

/**
 * The unique competitor names for one provider result, in the order the
 * chatbot presented them. Duplicates (including a shorter/longer form of
 * the same name, e.g. "Perficient" / "Perficient Latin America") keep their
 * first appearance.
 */
export function extractCompetitors(
  evidence: { answerHtml: string | null; answerText: string | null },
  client: CompetitorClientIdentity,
): string[] {
  let candidates: Candidate[];
  if (evidence.answerHtml) {
    const html = stripChrome(evidence.answerHtml);
    candidates = [
      ...leadingBoldCandidates(html),
      ...tableCandidates(html),
      ...geminiCardCandidates(html),
      ...chatGptEntityCandidates(html),
    ];
  } else {
    candidates = evidence.answerText ? markdownCandidates(evidence.answerText) : [];
  }

  const keys = clientKeys(client);
  const competitors: { name: string; key: string }[] = [];
  for (const candidate of [...candidates].sort((a, b) => a.position - b.position)) {
    for (const name of splitJoinedNames(cleanCompanyName(candidate.name))) {
      if (!isPlausibleCompanyName(name) || isClient(name, keys)) continue;
      const key = companyKey(name);
      const duplicate = competitors.some(
        (existing) => existing.key === key || existing.key.startsWith(`${key} `) || key.startsWith(`${existing.key} `),
      );
      if (!duplicate) competitors.push({ name, key });
    }
  }
  return competitors.map((competitor) => competitor.name);
}

/** Unique source URLs — the Sources KPI. Some providers repeat a URL once
 * per cited passage. */
export function countUniqueSources(sources: { url: string }[]): number {
  return new Set(sources.map((source) => source.url)).size;
}
