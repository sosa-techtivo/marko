import type { Browser, BrowserContext, Page } from "playwright-core";
import { normalizeHostname } from "../domain";
import type { AiVisibilityProviderResult, AiVisibilitySource } from "./types";

/**
 * MARKO's Claude *Browser* acquisition path: real browser automation of the
 * consumer Claude web experience (claude.ai) through playwright-core against
 * the host's installed Google Chrome. It never calls the Anthropic API. Same
 * contract as the other browser providers: the exact configured question in,
 * one normalized AiVisibilityProviderResult out.
 *
 * Access — always a fresh signed-out context; no profile, no login
 * automation. Observed (2026-10-01): signed-out claude.ai offers no chat —
 * a visible Chrome is redirected to claude.ai/login ("Sign in - Claude"),
 * and headless Chrome gets Cloudflare verification. Both are reported as a
 * Claude failure and never bypassed. The answer-capture path below only
 * runs if a chat input is actually reachable, and it never accepts the
 * question echo, an empty message, or page chrome as an answer.
 */

export const CLAUDE_WEB_URL = "https://claude.ai/new";
/** The underlying model is not reliably observable from the consumer UI. */
export const CLAUDE_WEB_MODEL = "claude-web";

const NAVIGATION_TIMEOUT_MS = 45_000;
/** Covers a Cloudflare check resolving on its own in a normal browser. */
const INPUT_TIMEOUT_MS = 30_000;
const RESPONSE_TIMEOUT_MS = 150_000;
const POLL_INTERVAL_MS = 1_000;
const STABLE_POLLS_REQUIRED = 3;
const RAW_HTML_MAX_LENGTH = 200_000;

const PROMPT_INPUT_SELECTOR = 'div[contenteditable="true"].ProseMirror, [data-testid="chat-input"] [contenteditable="true"]';
const SEND_BUTTON_SELECTOR = 'button[aria-label="Send message"], button[aria-label="Send Message"]';
/** Claude marks each assistant turn with data-is-streaming; the answer
 * prose is rendered inside it. */
const STREAMING_SELECTOR = "[data-is-streaming]";
const ANSWER_SELECTOR = ".font-claude-response, .font-claude-message";
const STOP_BUTTON_SELECTOR = 'button[aria-label*="Stop" i]';

/** Hosts that are Claude/Anthropic's own UI or generic pages, never sources. */
const CLAUDE_HOST_PATTERN = /(^|\.)(claude\.ai|claude\.com|anthropic\.com)$/i;

function isHeadless(): boolean {
  return process.env.CLAUDE_BROWSER_HEADLESS?.trim().toLowerCase() === "true";
}

/** A user-safe explanation when claude.ai showed verification or sign-in
 * instead of a chat. Null when it looks like the chat. Never bypassed. */
export function describeClaudeBlockedPage(pageUrl: string, pageTitle: string, visibleText: string): string | null {
  if (/just a moment|attention required|verify you are human|security verification/i.test(`${pageTitle}\n${visibleText}`)) {
    return "Claude showed a Cloudflare verification page to the browser. MARKO does not bypass it — try again later.";
  }
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return "Claude web did not load.";
  }
  if (url.pathname.startsWith("/login") || /^sign in\b/i.test(pageTitle)) {
    return "Claude web requires sign-in — signed-out claude.ai offers no chat. MARKO does not sign in automatically.";
  }
  if (!CLAUDE_HOST_PATTERN.test(url.hostname)) return "Claude web redirected to an unexpected page.";
  return null;
}

/** True when captured text is a real answer — non-empty and not merely the
 * submitted question echoed back. */
export function isClaudeAnswerText(text: string, questionText: string): boolean {
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
  return normalize(text) !== "" && normalize(text) !== normalize(questionText);
}

/** External http(s) links from the answer, excluding Claude/Anthropic's own
 * hosts, deduplicated by URL (first occurrence wins). */
export function buildClaudeSources(links: { href: string; label: string }[]): AiVisibilitySource[] {
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
    if (CLAUDE_HOST_PATTERN.test(url.hostname)) continue;
    const href = url.toString();
    if (seen.has(href)) continue;
    seen.add(href);
    const label = link.label.trim();
    sources.push({
      url: href,
      title: label !== "" && !/^\d+$/.test(label) ? label : null,
      domain: normalizeHostname(href),
      startIndex: null,
      endIndex: null,
    });
  }
  return sources;
}

function failure(error: string): AiVisibilityProviderResult {
  return { ok: false, provider: "anthropic", model: CLAUDE_WEB_MODEL, error };
}

export type ClaudeBrowserSession = {
  ask: (questionText: string) => Promise<AiVisibilityProviderResult>;
  close: () => Promise<void>;
};

export type OpenClaudeBrowserSessionResult = { ok: true; session: ClaudeBrowserSession } | { ok: false; error: string };

/** Launches one browser for a whole run. Never throws. */
export async function openClaudeBrowserSession(): Promise<OpenClaudeBrowserSessionResult> {
  let browser: Browser;
  let context: BrowserContext;
  try {
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({ channel: "chrome", headless: isHeadless() });
    context = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 } });
  } catch (err) {
    console.error("[ai-visibility][claude-browser] browser launch failed", {
      message: err instanceof Error ? err.message.split("\n")[0] : String(err),
    });
    return {
      ok: false,
      error:
        "Could not start the browser for Claude on this server. Browser mode needs Google Chrome installed on the MARKO server host, and a desktop session for its visible window.",
    };
  }
  return {
    ok: true,
    session: {
      ask: (questionText) => askClaudeWeb(context, questionText),
      close: async () => {
        await context.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
      },
    },
  };
}

async function blockedReason(page: Page): Promise<string | null> {
  const title = await page.title().catch(() => "");
  const text = await page.evaluate(() => document.body?.innerText.slice(0, 2_000) ?? "").catch(() => "");
  return describeClaudeBlockedPage(page.url(), title, text);
}

type AnswerState = { text: string; streaming: boolean; generating: boolean };

async function readAnswerState(page: Page): Promise<AnswerState> {
  return page
    .evaluate(
      ({ streamingSelector, answerSelector, stopSelector }) => {
        const turns = document.querySelectorAll(streamingSelector);
        const last = turns[turns.length - 1] as HTMLElement | undefined;
        const answer = (last?.querySelector(answerSelector) as HTMLElement | null) ?? null;
        return {
          text: answer?.innerText.trim() ?? "",
          streaming: last?.getAttribute("data-is-streaming") !== "false",
          generating: Boolean(document.querySelector(stopSelector)),
        };
      },
      { streamingSelector: STREAMING_SELECTOR, answerSelector: ANSWER_SELECTOR, stopSelector: STOP_BUTTON_SELECTOR },
    )
    .catch(() => ({ text: "", streaming: true, generating: true }));
}

async function waitForAnswer(page: Page, questionText: string): Promise<{ done: true } | { done: false; error: string }> {
  const deadline = Date.now() + RESPONSE_TIMEOUT_MS;
  let lastLength = -1;
  let stablePolls = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(POLL_INTERVAL_MS);
    const blocked = await blockedReason(page);
    if (blocked) return { done: false, error: blocked };
    const state = await readAnswerState(page);
    const length = state.text.length;
    if (isClaudeAnswerText(state.text, questionText) && !state.streaming && !state.generating && length === lastLength) {
      stablePolls += 1;
      if (stablePolls >= STABLE_POLLS_REQUIRED) return { done: true };
    } else {
      stablePolls = 0;
    }
    lastLength = length;
  }
  return { done: false, error: `Timed out after ${RESPONSE_TIMEOUT_MS / 1000}s waiting for Claude web to finish answering.` };
}

async function readAnswer(page: Page): Promise<{ text: string; html: string; links: { href: string; label: string }[] }> {
  return page.evaluate(
    ({ streamingSelector, answerSelector }) => {
      const turns = document.querySelectorAll(streamingSelector);
      const answer = turns[turns.length - 1]?.querySelector(answerSelector) as HTMLElement | null | undefined;
      if (!answer) return { text: "", html: "", links: [] };
      const links = ([...answer.querySelectorAll("a[href]")] as HTMLAnchorElement[]).map((anchor) => ({
        href: anchor.href,
        label: anchor.getAttribute("aria-label") ?? anchor.innerText,
      }));
      return { text: answer.innerText.trim(), html: answer.innerHTML, links };
    },
    { streamingSelector: STREAMING_SELECTOR, answerSelector: ANSWER_SELECTOR },
  );
}

/** Asks one question in a fresh Claude chat (a new tab per question).
 * Never throws. */
async function askClaudeWeb(context: BrowserContext, questionText: string): Promise<AiVisibilityProviderResult> {
  let page: Page | null = null;
  try {
    page = await context.newPage();
    try {
      await page.goto(CLAUDE_WEB_URL, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    } catch {
      return failure("Could not load Claude web in the browser.");
    }

    // Wait for either the chat input or a definitive sign-in page; a
    // Cloudflare check may resolve on its own meanwhile.
    const input = page.locator(PROMPT_INPUT_SELECTOR).first();
    const deadline = Date.now() + INPUT_TIMEOUT_MS;
    let inputVisible = false;
    while (Date.now() < deadline) {
      if (await input.isVisible().catch(() => false)) {
        inputVisible = true;
        break;
      }
      const url = page.url();
      if (new URL(url).pathname.startsWith("/login")) break;
      await page.waitForTimeout(POLL_INTERVAL_MS);
    }
    if (!inputVisible) {
      return failure((await blockedReason(page)) ?? "Could not find Claude's message input — the Claude web interface may have changed.");
    }

    await input.click();
    await page.keyboard.insertText(questionText);
    const typed = (await input.innerText().catch(() => "")).trim();
    if (typed !== questionText.trim()) {
      return failure("The question could not be entered into Claude web exactly as configured.");
    }
    const send = page.locator(SEND_BUTTON_SELECTOR).first();
    if (await send.isEnabled({ timeout: 2_000 }).catch(() => false)) {
      await send.click({ timeout: 5_000 });
    } else {
      await page.keyboard.press("Enter");
    }

    const waited = await waitForAnswer(page, questionText);
    if (!waited.done) return failure(waited.error);

    const answer = await readAnswer(page);
    if (!isClaudeAnswerText(answer.text, questionText)) return failure("Claude web returned an empty answer.");

    return {
      ok: true,
      provider: "anthropic",
      model: CLAUDE_WEB_MODEL,
      answerText: answer.text,
      sources: buildClaudeSources(answer.links),
      usage: null,
      raw: {
        executionMethod: "browser",
        surface: "claude.ai",
        conversationUrl: page.url(),
        signedIn: false,
        capturedAt: new Date().toISOString(),
        answerLinkCount: answer.links.length,
        answerLinks: answer.links,
        answerHtml: answer.html.slice(0, RAW_HTML_MAX_LENGTH),
        answerHtmlTruncated: answer.html.length > RAW_HTML_MAX_LENGTH,
      },
    };
  } catch (err) {
    console.error("[ai-visibility][claude-browser] question failed", {
      message: err instanceof Error ? err.message.split("\n")[0] : String(err),
    });
    return failure("The browser automation failed while asking Claude web.");
  } finally {
    await page?.close().catch(() => undefined);
  }
}
