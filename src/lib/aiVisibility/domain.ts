/**
 * Lowercased hostname, "www."-stripped — the same normalization
 * `src/lib/googleSearchConsole/propertyMatching.ts` uses for domain
 * comparison, kept as its own tiny module here since both the OpenAI
 * provider (labelling each returned source) and the Cited metric
 * (comparing a source's domain against the analyzed site's domain) need
 * it. Returns null when `url` doesn't parse as a URL at all.
 */
export function normalizeHostname(url: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}
