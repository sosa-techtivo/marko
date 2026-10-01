import type { Browser, BrowserContext, Page } from "playwright-core";
import { normalizeHostname } from "../domain";
import type { AiVisibilityProviderResult, AiVisibilitySource } from "./types";

/**
 * MARKO's Gemini *Browser* acquisition path: real browser automation of the
 * consumer Gemini web experience (gemini.google.com), driven through
 * playwright-core against the host's installed Google Chrome. It never calls
 * the Gemini API — the answer is what the web UI renders.
 *
 * It submits the exact configured question text, waits for generation to
 * finish, and captures the rendered answer plus the citation links Gemini
 * attaches to it, normalized into the same AiVisibilityProviderResult shape
 * gemini.ts produces — so runAiVisibility.ts applies the identical
 * downstream metrics/persistence and only the acquisition method differs.
 *
 * Session: by default a fresh, signed-out browser context per run (no
 * account, no personalization — what an anonymous user sees). Setting
 * GEMINI_BROWSER_PROFILE_DIR instead reuses a persistent Chrome profile
 * that a human has signed into manually (see .env.example); MARKO never
 * automates a Google login. A sign-in wall, consent page or CAPTCHA is
 * reported as a failure — never bypassed.
 *
 * Server-host requirement: this launches a real Chrome process, so it only
 * runs on a long-lived Node host with Chrome installed (e.g. `next start`
 * on a workstation/VM). It's opt-in via AI_VISIBILITY_BROWSER_ENABLED so a
 * serverless deployment never attempts it.
 */

export const GEMINI_WEB_URL = "https://gemini.google.com/app";
/** Recorded as the run/result `model` when the web UI's mode label can't be
 * read — the web surface doesn't expose an exact API model id. */
export const GEMINI_WEB_MODEL = "gemini-web";

const NAVIGATION_TIMEOUT_MS = 45_000;
const INPUT_TIMEOUT_MS = 20_000;
/** Web answers with search grounding observed at ~15–30s; generous margin. */
const RESPONSE_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 1_000;
/** Consecutive identical polls (after the stop button disappears) before the
 * answer is treated as final — guards against capturing a half-rendered
 * answer between streaming chunks. */
const STABLE_POLLS_REQUIRED = 2;
const SOURCE_CARD_TIMEOUT_MS = 3_000;
const MAX_CITATION_CHIPS = 40;
const RAW_HTML_MAX_LENGTH = 200_000;

const PROMPT_INPUT_SELECTOR = 'rich-textarea div.ql-editor[contenteditable="true"]';
const PROMPT_INPUT_FALLBACK_SELECTOR = 'div[contenteditable="true"][aria-label*="prompt" i]';
const MODEL_RESPONSE_SELECTOR = "model-response";
const MESSAGE_CONTENT_SELECTOR = "message-content";
const CITATION_CHIP_SELECTOR = 'button[aria-label^="View source details"]';
const SOURCE_CARD_LINK_SELECTOR = ".cdk-overlay-pane a[href]";
/** Inline citation chips render the source's name inside the answer; hidden
 * while reading the answer text so a chip label (e.g. a competitor's domain)
 * is never counted as the answer itself mentioning it. */
const CITATION_CHIP_CONTAINER_SELECTOR = "source-inline-chip, sources-carousel-inline";
const MODE_PICKER_SELECTOR = 'button[data-test-id="bard-mode-menu-button"]';
const SIGN_IN_LINK_SELECTOR = 'a[href^="https://accounts.google.com/ServiceLogin"]';

export function isGeminiBrowserEnabled(): boolean {
  return process.env.AI_VISIBILITY_BROWSER_ENABLED?.trim().toLowerCase() === "true";
}

/**
 * One browser run at a time per server process: concurrent runs would
 * contend for the same Chrome profile directory (Chrome locks it) and
 * multiply anonymous traffic to Gemini. Acquired synchronously, so two
 * near-simultaneous requests can't both pass.
 */
let browserRunInProgress = false;

export function tryAcquireGeminiBrowserLock(): boolean {
  if (browserRunInProgress) return false;
  browserRunInProgress = true;
  return true;
}

export function releaseGeminiBrowserLock(): void {
  browserRunInProgress = false;
}

/** Strips a citation link's text fragment (`#:~:text=…`, which Gemini adds
 * to highlight the quoted passage) so the same page cited for different
 * passages is one source. Null for non-http(s) links. */
export function normalizeGeminiCitationUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hash.startsWith("#:~:")) url.hash = "";
  return url.toString();
}

/** A source card link's visible text is "<source name>\n<page title>\n<quote>";
 * the page title is the second non-empty line when present. */
export function parseGeminiSourceTitle(linkText: string): string | null {
  const lines = linkText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return lines[1] ?? lines[0] ?? null;
}

/** Deduplicated (by normalized URL, first occurrence wins) sources from the
 * raw citation links captured off the page. Offsets are null: the web UI
 * gives no character-level attribution into the rendered answer text. */
export function buildGeminiBrowserSources(links: { href: string; text: string }[]): AiVisibilitySource[] {
  const seen = new Set<string>();
  const sources: AiVisibilitySource[] = [];
  for (const link of links) {
    const url = normalizeGeminiCitationUrl(link.href);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    sources.push({
      url,
      title: parseGeminiSourceTitle(link.text),
      domain: normalizeHostname(url),
      startIndex: null,
      endIndex: null,
    });
  }
  return sources;
}

/** "Open mode picker, currently Flash-Lite" → "gemini-web (Flash-Lite)". */
export function geminiWebModelFromModeLabel(ariaLabel: string | null): string {
  const match = ariaLabel?.match(/currently\s+(.+)$/i);
  const mode = match?.[1]?.trim();
  return mode ? `${GEMINI_WEB_MODEL} (${mode})` : GEMINI_WEB_MODEL;
}

/** A user-safe explanation when navigation landed somewhere other than the
 * Gemini app — a Google sign-in, consent or anti-abuse page. Null when the
 * URL is the Gemini app itself. MARKO reports these; it never bypasses them. */
export function describeGeminiWebBlockedPage(pageUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return "Gemini web did not load.";
  }
  if (url.hostname === "gemini.google.com") return null;
  if (url.hostname === "accounts.google.com") {
    return "Gemini web required a Google sign-in. If GEMINI_BROWSER_PROFILE_DIR is set, its signed-in session may have expired.";
  }
  if (url.hostname === "consent.google.com") {
    return "Gemini web showed a Google consent page that must be accepted manually in the browser profile.";
  }
  if (url.pathname.startsWith("/sorry")) {
    return "Google showed a verification (CAPTCHA) page to the browser. MARKO does not bypass it — try again later.";
  }
  return "Gemini web redirected to an unexpected page.";
}

function failure(model: string, error: string): AiVisibilityProviderResult {
  return { ok: false, provider: "gemini", model, error };
}

export type GeminiBrowserSession = {
  ask: (questionText: string) => Promise<AiVisibilityProviderResult>;
  close: () => Promise<void>;
};

export type OpenGeminiBrowserSessionResult = { ok: true; session: GeminiBrowserSession } | { ok: false; error: string };

/**
 * Launches the browser once for a whole run. Never throws — a launch failure
 * (Chrome missing, profile locked) comes back as `{ ok: false }` with a
 * user-safe message; the underlying error is logged server-side only.
 */
export async function openGeminiBrowserSession(): Promise<OpenGeminiBrowserSessionResult> {
  const profileDir = process.env.GEMINI_BROWSER_PROFILE_DIR?.trim() || null;
  const headless = process.env.GEMINI_BROWSER_HEADLESS?.trim().toLowerCase() !== "false";
  const contextOptions = { locale: "en-US", viewport: { width: 1280, height: 900 } };

  let browser: Browser | null = null;
  let context: BrowserContext;
  try {
    const { chromium } = await import("playwright-core");
    if (profileDir) {
      context = await chromium.launchPersistentContext(profileDir, { channel: "chrome", headless, ...contextOptions });
    } else {
      browser = await chromium.launch({ channel: "chrome", headless });
      context = await browser.newContext(contextOptions);
    }
  } catch (err) {
    console.error("[ai-visibility][gemini-browser] browser launch failed", {
      message: err instanceof Error ? err.message.split("\n")[0] : String(err),
    });
    await browser?.close().catch(() => undefined);
    return {
      ok: false,
      error:
        "Could not start the browser on this server. Browser mode needs Google Chrome installed on the MARKO server host (and the profile directory not in use by another Chrome window).",
    };
  }

  return {
    ok: true,
    session: {
      ask: (questionText) => askGeminiWeb(context, questionText),
      close: async () => {
        await context.close().catch(() => undefined);
        await browser?.close().catch(() => undefined);
      },
    },
  };
}

type ResponseState = { responseCount: number; generating: boolean; textLength: number };

async function readResponseState(page: Page): Promise<ResponseState> {
  return page.evaluate(
    ({ responseSelector, contentSelector }) => {
      const responses = document.querySelectorAll(responseSelector);
      const last = responses[responses.length - 1];
      const stopVisible = [...document.querySelectorAll("button")].some((button) =>
        /stop/i.test(button.getAttribute("aria-label") ?? ""),
      );
      const busy = Boolean(last?.querySelector('[aria-busy="true"]'));
      const content = last?.querySelector(contentSelector) as HTMLElement | null | undefined;
      return {
        responseCount: responses.length,
        generating: stopVisible || busy,
        textLength: content?.innerText.trim().length ?? 0,
      };
    },
    { responseSelector: MODEL_RESPONSE_SELECTOR, contentSelector: MESSAGE_CONTENT_SELECTOR },
  );
}

/** Polls until the latest answer exists, generation has stopped, and its
 * text has stopped changing. False on timeout. */
async function waitForAnswerComplete(page: Page): Promise<boolean> {
  const deadline = Date.now() + RESPONSE_TIMEOUT_MS;
  let lastLength = -1;
  let stablePolls = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(POLL_INTERVAL_MS);
    const state = await readResponseState(page);
    if (state.responseCount > 0 && !state.generating && state.textLength > 0 && state.textLength === lastLength) {
      stablePolls += 1;
      if (stablePolls >= STABLE_POLLS_REQUIRED) return true;
    } else {
      stablePolls = 0;
    }
    lastLength = state.textLength;
  }
  return false;
}

/** Each citation chip opens a small source card with the cited link(s);
 * clicks every chip in the answer (bounded) and collects those links.
 * Best-effort: a chip that fails to open is skipped and reported via
 * `complete: false`, never fails the captured answer. */
async function collectCitationLinks(page: Page): Promise<{ links: { href: string; text: string }[]; chipCount: number; complete: boolean }> {
  const chips = page.locator(`${MODEL_RESPONSE_SELECTOR} ${CITATION_CHIP_SELECTOR}`);
  const chipCount = await chips.count();
  const links: { href: string; text: string }[] = [];
  let complete = chipCount <= MAX_CITATION_CHIPS;

  for (let i = 0; i < Math.min(chipCount, MAX_CITATION_CHIPS); i++) {
    try {
      const chip = chips.nth(i);
      await chip.scrollIntoViewIfNeeded({ timeout: SOURCE_CARD_TIMEOUT_MS });
      await chip.click({ timeout: SOURCE_CARD_TIMEOUT_MS });
      await page.locator(SOURCE_CARD_LINK_SELECTOR).first().waitFor({ timeout: SOURCE_CARD_TIMEOUT_MS });
      const cardLinks = await page.$$eval(SOURCE_CARD_LINK_SELECTOR, (anchors) =>
        anchors.map((anchor) => ({ href: (anchor as HTMLAnchorElement).href, text: (anchor as HTMLElement).innerText })),
      );
      links.push(...cardLinks);
    } catch {
      complete = false;
    } finally {
      await page.keyboard.press("Escape").catch(() => undefined);
    }
  }
  return { links, chipCount, complete };
}

async function readAnswer(page: Page): Promise<{ text: string; html: string }> {
  return page.evaluate(
    ({ responseSelector, contentSelector, chipSelector }) => {
      const responses = document.querySelectorAll(responseSelector);
      const content = responses[responses.length - 1]?.querySelector(contentSelector) as HTMLElement | null | undefined;
      if (!content) return { text: "", html: "" };
      const style = document.createElement("style");
      style.textContent = `${chipSelector} { display: none !important; }`;
      document.head.appendChild(style);
      try {
        return { text: content.innerText.trim(), html: content.innerHTML };
      } finally {
        style.remove();
      }
    },
    {
      responseSelector: MODEL_RESPONSE_SELECTOR,
      contentSelector: MESSAGE_CONTENT_SELECTOR,
      chipSelector: CITATION_CHIP_CONTAINER_SELECTOR,
    },
  );
}

/**
 * Asks one question in a fresh Gemini web chat (a new tab per question, so
 * no question sees another's conversation). Never throws — every failure
 * (navigation, sign-in/consent/CAPTCHA wall, missing input, timeout, empty
 * answer) returns `{ ok: false }` with a user-safe message.
 */
async function askGeminiWeb(context: BrowserContext, questionText: string): Promise<AiVisibilityProviderResult> {
  let model = GEMINI_WEB_MODEL;
  let page: Page | null = null;
  try {
    page = await context.newPage();

    try {
      await page.goto(GEMINI_WEB_URL, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    } catch {
      return failure(model, "Could not load Gemini web in the browser.");
    }

    const blocked = describeGeminiWebBlockedPage(page.url());
    if (blocked) return failure(model, blocked);

    const input = page.locator(PROMPT_INPUT_SELECTOR).or(page.locator(PROMPT_INPUT_FALLBACK_SELECTOR)).first();
    try {
      await input.waitFor({ state: "visible", timeout: INPUT_TIMEOUT_MS });
    } catch {
      return failure(
        model,
        describeGeminiWebBlockedPage(page.url()) ??
          "Could not find Gemini's prompt input — the Gemini web interface may have changed.",
      );
    }

    model = geminiWebModelFromModeLabel(
      await page
        .locator(MODE_PICKER_SELECTOR)
        .first()
        .getAttribute("aria-label", { timeout: 2_000 })
        .catch(() => null),
    );
    const signedIn = (await page.locator(SIGN_IN_LINK_SELECTOR).count()) === 0;

    await input.click();
    await page.keyboard.insertText(questionText);
    const typed = (await input.innerText()).trim();
    if (typed !== questionText.trim()) {
      return failure(model, "The question could not be entered into Gemini web exactly as configured.");
    }
    await page.keyboard.press("Enter");

    if (!(await waitForAnswerComplete(page))) {
      return failure(model, `Timed out after ${RESPONSE_TIMEOUT_MS / 1000}s waiting for Gemini web to finish answering.`);
    }

    const citations = await collectCitationLinks(page);
    const answer = await readAnswer(page);
    if (answer.text === "") return failure(model, "Gemini web returned an empty answer.");

    return {
      ok: true,
      provider: "gemini",
      model,
      answerText: answer.text,
      sources: buildGeminiBrowserSources(citations.links),
      usage: null,
      raw: {
        executionMethod: "browser",
        surface: "gemini.google.com",
        conversationUrl: page.url(),
        modelLabel: model,
        signedIn,
        capturedAt: new Date().toISOString(),
        citationChipCount: citations.chipCount,
        sourcesExtractionComplete: citations.complete,
        citationLinks: citations.links,
        answerHtml: answer.html.slice(0, RAW_HTML_MAX_LENGTH),
        answerHtmlTruncated: answer.html.length > RAW_HTML_MAX_LENGTH,
      },
    };
  } catch (err) {
    console.error("[ai-visibility][gemini-browser] question failed", {
      message: err instanceof Error ? err.message.split("\n")[0] : String(err),
    });
    return failure(model, "The browser automation failed while asking Gemini web.");
  } finally {
    await page?.close().catch(() => undefined);
  }
}
