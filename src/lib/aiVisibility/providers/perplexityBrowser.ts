import type { Browser, BrowserContext, Page } from "playwright-core";
import { normalizeHostname } from "../domain";
import type { AiVisibilityProviderResult, AiVisibilitySource } from "./types";

/**
 * MARKO's Perplexity *Browser* acquisition path: real browser automation of
 * the consumer Perplexity web experience (www.perplexity.ai) through
 * playwright-core against the host's installed Google Chrome. It never
 * calls the Perplexity API. Same contract as geminiBrowser.ts and
 * chatgptBrowser.ts: the exact configured question in, one normalized
 * AiVisibilityProviderResult out.
 *
 * Access: by default a fresh signed-out context. Observed (2026-10-01):
 * signed-out automated use is gated — Perplexity answered the first query
 * with a "Sign in to continue" wall, and served Cloudflare verification
 * on retry; headless Chrome gets Cloudflare verification immediately. MARKO
 * reports each of these as a Perplexity failure and never bypasses them.
 * PERPLEXITY_BROWSER_PROFILE_DIR may point at a Chrome profile a human has
 * signed into manually (same pattern as GEMINI_BROWSER_PROFILE_DIR); MARKO
 * never automates a login. Visible window by default
 * (PERPLEXITY_BROWSER_HEADLESS=true opts into headless).
 */

export const PERPLEXITY_WEB_URL = "https://www.perplexity.ai/";
/** The consumer UI doesn't reliably expose the underlying model. */
export const PERPLEXITY_WEB_MODEL = "perplexity-web";

const NAVIGATION_TIMEOUT_MS = 45_000;
const INPUT_TIMEOUT_MS = 30_000;
/** Search/research answers can take a while; generous margin. */
const RESPONSE_TIMEOUT_MS = 150_000;
const POLL_INTERVAL_MS = 1_000;
/** Perplexity streams in bursts between research steps — require a longer
 * quiet period before treating the answer as final. */
const STABLE_POLLS_REQUIRED = 3;
const RAW_HTML_MAX_LENGTH = 200_000;

const PROMPT_INPUT_SELECTOR = '#ask-input, div[contenteditable="true"][data-lexical-editor], textarea[placeholder*="Ask" i]';
const SUBMIT_BUTTON_SELECTOR = 'button[aria-label="Submit"], button[data-testid="submit-button"]';
/** The model's final answer only. The user's own question is also rendered
 * as markdown (`data-renderer="lm"`) outside this container, so an
 * unscoped selector would capture the question as the "answer". */
const ANSWER_SELECTOR = '[data-workflow-final-text] [data-renderer="lm"]';
const STOP_BUTTON_SELECTOR = 'button[aria-label*="Stop" i], button[data-testid*="stop" i]';

/** Text Perplexity shows instead of an answer when it requires an account. */
const SIGN_IN_WALL_PATTERN = /sign (in|up) (to continue|and repeat your request)/i;
/** Hosts that are Perplexity's own UI, never answer sources. */
const PERPLEXITY_HOST_PATTERN = /(^|\.)(perplexity\.ai|pplx\.ai)$/i;
/** An inline citation marker's text: "1", "clutch.co", "clutch+2". */
export const CITATION_MARKER_TEXT = /^\s*(\d+|[a-z0-9-]+(\.[a-z0-9-]+)*(\s*\+\s*\d+)?)\s*$/;

function isHeadless(): boolean {
  return process.env.PERPLEXITY_BROWSER_HEADLESS?.trim().toLowerCase() === "true";
}

/** Answer links that are real sources: http(s), not Perplexity's own UI,
 * deduplicated by URL (first occurrence wins), titled by the link's label
 * when it reads like a title rather than a citation marker. */
export function buildPerplexitySources(links: { href: string; label: string }[]): AiVisibilitySource[] {
  const seen = new Set<string>();
  const sources: AiVisibilitySource[] = [];
  for (const link of links) {
    let url: URL;
    try {
      url = new URL(link.href);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (PERPLEXITY_HOST_PATTERN.test(url.hostname)) continue;
    const href = url.toString();
    if (seen.has(href)) continue;
    seen.add(href);
    const label = link.label.trim();
    sources.push({
      url: href,
      title: label !== "" && !CITATION_MARKER_TEXT.test(label) ? label : null,
      domain: normalizeHostname(href),
      startIndex: null,
      endIndex: null,
    });
  }
  return sources;
}

/** A user-safe explanation when Perplexity showed a verification or sign-in
 * wall instead of an answer. Null when it looks like a normal answer page.
 * MARKO reports these; it never bypasses them. */
export function describePerplexityBlockedPage(pageTitle: string, visibleText: string): string | null {
  if (/just a moment|attention required|verify you are human|security verification/i.test(`${pageTitle}\n${visibleText}`)) {
    return "Perplexity showed a Cloudflare verification page to the browser. MARKO does not bypass it — try again later.";
  }
  if (SIGN_IN_WALL_PATTERN.test(visibleText)) {
    return "Perplexity web required sign-in for this request (\"Sign in to continue using Perplexity\"). MARKO does not sign in automatically.";
  }
  return null;
}

function failure(error: string): AiVisibilityProviderResult {
  return { ok: false, provider: "perplexity", model: PERPLEXITY_WEB_MODEL, error };
}

export type PerplexityBrowserSession = {
  ask: (questionText: string) => Promise<AiVisibilityProviderResult>;
  close: () => Promise<void>;
};

export type OpenPerplexityBrowserSessionResult =
  | { ok: true; session: PerplexityBrowserSession }
  | { ok: false; error: string };

/** Launches one browser for a whole run. Never throws. */
export async function openPerplexityBrowserSession(): Promise<OpenPerplexityBrowserSessionResult> {
  const profileDir = process.env.PERPLEXITY_BROWSER_PROFILE_DIR?.trim() || null;
  const contextOptions = { locale: "en-US", viewport: { width: 1280, height: 900 } };
  let browser: Browser | null = null;
  let context: BrowserContext;
  try {
    const { chromium } = await import("playwright-core");
    if (profileDir) {
      context = await chromium.launchPersistentContext(profileDir, { channel: "chrome", headless: isHeadless(), ...contextOptions });
    } else {
      browser = await chromium.launch({ channel: "chrome", headless: isHeadless() });
      context = await browser.newContext(contextOptions);
    }
  } catch (err) {
    console.error("[ai-visibility][perplexity-browser] browser launch failed", {
      message: err instanceof Error ? err.message.split("\n")[0] : String(err),
    });
    await browser?.close().catch(() => undefined);
    return {
      ok: false,
      error:
        "Could not start the browser for Perplexity on this server. Browser mode needs Google Chrome installed on the MARKO server host, a desktop session for its visible window, and the profile directory not in use by another Chrome window.",
    };
  }

  return {
    ok: true,
    session: {
      ask: (questionText) => askPerplexityWeb(context, questionText),
      close: async () => {
        await context.close().catch(() => undefined);
        await browser?.close().catch(() => undefined);
      },
    },
  };
}

type PageState = { title: string; bodyText: string; answerText: string; generating: boolean };

async function readPageState(page: Page): Promise<PageState> {
  const title = await page.title().catch(() => "");
  const state = await page
    .evaluate(
      ({ answerSelector, stopSelector }) => {
        const answers = document.querySelectorAll(answerSelector);
        const last = answers[answers.length - 1] as HTMLElement | undefined;
        return {
          bodyText: document.body?.innerText.slice(0, 4_000) ?? "",
          answerText: last?.innerText.trim() ?? "",
          generating: Boolean(document.querySelector(stopSelector)),
        };
      },
      { answerSelector: ANSWER_SELECTOR, stopSelector: STOP_BUTTON_SELECTOR },
    )
    .catch(() => ({ bodyText: "", answerText: "", generating: true }));
  return { title, ...state };
}

/** True when captured text is a real answer — non-empty and not merely the
 * submitted question echoed back. */
export function isPerplexityAnswerText(text: string, questionText: string): boolean {
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
  return normalize(text) !== "" && normalize(text) !== normalize(questionText);
}

/** Polls until the answer exists, generation stopped, and its text stopped
 * changing — or a verification/sign-in wall appears. */
async function waitForAnswer(page: Page, questionText: string): Promise<{ done: true } | { done: false; error: string }> {
  const deadline = Date.now() + RESPONSE_TIMEOUT_MS;
  let lastLength = -1;
  let stablePolls = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(POLL_INTERVAL_MS);
    const state = await readPageState(page);
    const blocked = describePerplexityBlockedPage(state.title, state.bodyText);
    if (blocked) return { done: false, error: blocked };
    const length = state.answerText.length;
    if (isPerplexityAnswerText(state.answerText, questionText) && !state.generating && length === lastLength) {
      stablePolls += 1;
      if (stablePolls >= STABLE_POLLS_REQUIRED) return { done: true };
    } else {
      stablePolls = 0;
    }
    lastLength = length;
  }
  return { done: false, error: `Timed out after ${RESPONSE_TIMEOUT_MS / 1000}s waiting for Perplexity web to finish answering.` };
}

/** The answer text with inline citation markers hidden (so "clutch+2" never
 * reads as part of the answer), the answer's links, and its HTML. */
async function readAnswer(page: Page): Promise<{ text: string; html: string; links: { href: string; label: string }[] }> {
  return page.evaluate(
    ({ answerSelector, markerSource }) => {
      const answers = document.querySelectorAll(answerSelector);
      const answer = answers[answers.length - 1] as HTMLElement | undefined;
      if (!answer) return { text: "", html: "", links: [] };
      const marker = new RegExp(markerSource);
      const anchors = [...answer.querySelectorAll("a[href]")] as HTMLAnchorElement[];
      const links = anchors.map((anchor) => ({
        href: anchor.href,
        label: anchor.getAttribute("aria-label") ?? anchor.title ?? anchor.innerText,
      }));
      const hidden = anchors.filter((anchor) => marker.test(anchor.innerText));
      for (const anchor of hidden) anchor.setAttribute("data-marko-hidden-citation", "");
      const style = document.createElement("style");
      style.textContent = "[data-marko-hidden-citation] { display: none !important; }";
      document.head.appendChild(style);
      try {
        return { text: answer.innerText.trim(), html: answer.innerHTML, links };
      } finally {
        style.remove();
        for (const anchor of hidden) anchor.removeAttribute("data-marko-hidden-citation");
      }
    },
    { answerSelector: ANSWER_SELECTOR, markerSource: CITATION_MARKER_TEXT.source },
  );
}

/**
 * Asks one question in a fresh Perplexity thread (a new tab per question).
 * Never throws — every failure returns `{ ok: false }` with a user-safe
 * message.
 */
async function askPerplexityWeb(context: BrowserContext, questionText: string): Promise<AiVisibilityProviderResult> {
  let page: Page | null = null;
  try {
    page = await context.newPage();

    try {
      await page.goto(PERPLEXITY_WEB_URL, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    } catch {
      return failure("Could not load Perplexity web in the browser.");
    }

    const input = page.locator(PROMPT_INPUT_SELECTOR).first();
    try {
      await input.waitFor({ state: "visible", timeout: INPUT_TIMEOUT_MS });
    } catch {
      const state = await readPageState(page);
      return failure(
        describePerplexityBlockedPage(state.title, state.bodyText) ??
          "Could not find Perplexity's question input — the Perplexity web interface may have changed.",
      );
    }

    // Privacy-preserving choice on the cookie banner, when shown.
    const onlyNecessary = page.getByRole("button", { name: /only necessary/i }).first();
    if (await onlyNecessary.isVisible().catch(() => false)) {
      await onlyNecessary.click({ timeout: 3_000 }).catch(() => undefined);
    }

    await input.click();
    await page.keyboard.insertText(questionText);
    const signedIn = (await page.getByRole("button", { name: /^sign in$/i }).count().catch(() => 0)) === 0;
    const typed = (await input.innerText().catch(() => "")).trim();
    if (typed !== questionText.trim()) {
      return failure("The question could not be entered into Perplexity web exactly as configured.");
    }
    const submit = page.locator(SUBMIT_BUTTON_SELECTOR).first();
    if (await submit.isEnabled({ timeout: 2_000 }).catch(() => false)) {
      await submit.click({ timeout: 5_000 });
    } else {
      await page.keyboard.press("Enter");
    }

    const waited = await waitForAnswer(page, questionText);
    if (!waited.done) return failure(waited.error);

    const answer = await readAnswer(page);
    const blocked = describePerplexityBlockedPage("", answer.text);
    if (blocked) return failure(blocked);
    if (!isPerplexityAnswerText(answer.text, questionText)) return failure("Perplexity web returned an empty answer.");

    const sources = buildPerplexitySources(answer.links);
    return {
      ok: true,
      provider: "perplexity",
      model: PERPLEXITY_WEB_MODEL,
      answerText: answer.text,
      sources,
      usage: null,
      raw: {
        executionMethod: "browser",
        surface: "perplexity.ai",
        conversationUrl: page.url(),
        signedIn,
        capturedAt: new Date().toISOString(),
        answerLinkCount: answer.links.length,
        answerLinks: answer.links,
        answerHtml: answer.html.slice(0, RAW_HTML_MAX_LENGTH),
        answerHtmlTruncated: answer.html.length > RAW_HTML_MAX_LENGTH,
      },
    };
  } catch (err) {
    console.error("[ai-visibility][perplexity-browser] question failed", {
      message: err instanceof Error ? err.message.split("\n")[0] : String(err),
    });
    return failure("The browser automation failed while asking Perplexity web.");
  } finally {
    await page?.close().catch(() => undefined);
  }
}
