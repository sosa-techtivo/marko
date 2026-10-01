import type { Browser, BrowserContext, Page } from "playwright-core";
import { normalizeHostname } from "../domain";
import type { AiVisibilityProviderResult, AiVisibilitySource } from "./types";

/**
 * MARKO's ChatGPT *Browser* acquisition path: real browser automation of the
 * consumer ChatGPT web experience (chatgpt.com), signed out, through
 * playwright-core against the host's installed Google Chrome. It never calls
 * the OpenAI API — the answer is what the web UI renders. Same contract as
 * geminiBrowser.ts: the exact configured question text in, one normalized
 * AiVisibilityProviderResult out, so runAiVisibility.ts applies the same
 * downstream metrics/persistence.
 *
 * Visible window by default: chatgpt.com serves a Cloudflare verification
 * page to headless Chrome, while a normal (headed) Chrome reaches the chat.
 * MARKO does not attempt to pass or evade that verification — if it appears
 * (headed or headless), the question fails with a clear message. Set
 * CHATGPT_BROWSER_HEADLESS=true to opt into headless anyway.
 *
 * Always a fresh signed-out context: no account, no cookies, no
 * personalization. The cookie banner's "Reject non-essential" is chosen when
 * shown.
 */

export const CHATGPT_WEB_URL = "https://chatgpt.com/";
/** The signed-out web UI exposes no model name. */
export const CHATGPT_WEB_MODEL = "chatgpt-web";

const NAVIGATION_TIMEOUT_MS = 45_000;
const INPUT_TIMEOUT_MS = 30_000;
/** Web-search answers observed at ~10–30s; generous margin. */
const RESPONSE_TIMEOUT_MS = 150_000;
const POLL_INTERVAL_MS = 1_000;
const STABLE_POLLS_REQUIRED = 2;
const RAW_HTML_MAX_LENGTH = 200_000;

const PROMPT_INPUT_SELECTOR = '#prompt-textarea, textarea[name="prompt-textarea"], textarea#mobile-composer-prompt';
const SEND_BUTTON_SELECTOR = 'button[aria-label="Send message"], button[data-testid="send-button"]';
const ASSISTANT_MESSAGE_SELECTOR = 'li[data-message-role="assistant"]';
const MARKDOWN_SELECTOR = "[data-assistant-markdown]";
const SOURCES_PAYLOAD_ATTRIBUTE = "data-assistant-sources-payload";
/** Hidden while reading the answer text:
 *  - inline citation chips (grouped sources) — their source names must
 *    never count as the answer mentioning them (same reasoning as
 *    geminiBrowser.ts's citation chips);
 *  - the business map-card carousel — repeated rating/"Open" card UI,
 *    not answer prose (its businesses stay in the captured HTML);
 *  - a link reference's domain detail ("perficient.com" next to the
 *    linked name).
 * Link references themselves stay visible: ChatGPT often renders a company
 * name (e.g. in a table) as a link, and that name is part of the answer. */
const SOURCE_CHIP_SELECTOR = [
  '[data-content-reference-type="grouped_webpages"]',
  "[data-assistant-grouped-webpages-trigger]",
  '[data-content-reference-type="map"]',
  "[data-assistant-reference-detail]",
].join(", ");
const STOP_BUTTON_SELECTOR = 'button[aria-label*="Stop" i], button[data-testid="stop-button"]';

function isHeadless(): boolean {
  return process.env.CHATGPT_BROWSER_HEADLESS?.trim().toLowerCase() === "true";
}

/** One citation entry from a source trigger's JSON payload. */
type ChatGptSourcePayloadItem = { url?: unknown; title?: unknown };

/** Parses every source trigger's JSON payload into deduplicated (by URL,
 * first occurrence wins) sources. URLs are kept exactly as ChatGPT links
 * them (including its utm_source tag) — evidence, not cleaned-up data.
 * Malformed payloads are skipped, never fatal. */
export function parseChatGptSourcePayloads(payloads: string[]): AiVisibilitySource[] {
  const seen = new Set<string>();
  const sources: AiVisibilitySource[] = [];
  for (const payload of payloads) {
    let items: unknown;
    try {
      items = JSON.parse(payload);
    } catch {
      continue;
    }
    if (!Array.isArray(items)) continue;
    for (const item of items as ChatGptSourcePayloadItem[]) {
      if (typeof item?.url !== "string" || seen.has(item.url)) continue;
      let protocol: string;
      try {
        protocol = new URL(item.url).protocol;
      } catch {
        continue;
      }
      if (protocol !== "http:" && protocol !== "https:") continue;
      seen.add(item.url);
      sources.push({
        url: item.url,
        title: typeof item.title === "string" && item.title.trim() !== "" ? item.title.trim() : null,
        domain: normalizeHostname(item.url),
        startIndex: null,
        endIndex: null,
      });
    }
  }
  return sources;
}

/** A user-safe explanation when chatgpt.com showed a verification, login
 * or other blocking page instead of the chat. Null when it looks like the
 * chat. MARKO reports these; it never bypasses them. */
export function describeChatGptBlockedPage(pageUrl: string, pageTitle: string): string | null {
  if (/just a moment|attention required|verify you are human/i.test(pageTitle)) {
    return "ChatGPT showed a Cloudflare verification page to the browser. MARKO does not bypass it — try again later.";
  }
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return "ChatGPT web did not load.";
  }
  if (url.hostname === "auth.openai.com" || url.pathname.startsWith("/auth")) {
    return "ChatGPT web required a login for this request. MARKO only uses signed-out ChatGPT.";
  }
  if (url.hostname !== "chatgpt.com") return "ChatGPT web redirected to an unexpected page.";
  return null;
}

function failure(error: string): AiVisibilityProviderResult {
  return { ok: false, provider: "openai", model: CHATGPT_WEB_MODEL, error };
}

export type ChatGptBrowserSession = {
  ask: (questionText: string) => Promise<AiVisibilityProviderResult>;
  close: () => Promise<void>;
};

export type OpenChatGptBrowserSessionResult = { ok: true; session: ChatGptBrowserSession } | { ok: false; error: string };

/** Launches one browser for a whole run. Never throws. */
export async function openChatGptBrowserSession(): Promise<OpenChatGptBrowserSessionResult> {
  let browser: Browser;
  let context: BrowserContext;
  try {
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({ channel: "chrome", headless: isHeadless() });
    context = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 } });
  } catch (err) {
    console.error("[ai-visibility][chatgpt-browser] browser launch failed", {
      message: err instanceof Error ? err.message.split("\n")[0] : String(err),
    });
    return {
      ok: false,
      error:
        "Could not start the browser for ChatGPT on this server. Browser mode needs Google Chrome installed on the MARKO server host, and a desktop session for its visible window.",
    };
  }

  return {
    ok: true,
    session: {
      ask: (questionText) => askChatGptWeb(context, questionText),
      close: async () => {
        await context.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
      },
    },
  };
}

type ResponseState = { assistantCount: number; complete: boolean; generating: boolean; textLength: number };

async function readResponseState(page: Page): Promise<ResponseState> {
  return page.evaluate(
    ({ assistantSelector, stopSelector }) => {
      const messages = document.querySelectorAll(assistantSelector);
      const last = messages[messages.length - 1] as HTMLElement | undefined;
      return {
        assistantCount: messages.length,
        complete: Boolean(last?.hasAttribute("data-message-complete")),
        generating: Boolean(document.querySelector(stopSelector)),
        textLength: last?.innerText.trim().length ?? 0,
      };
    },
    { assistantSelector: ASSISTANT_MESSAGE_SELECTOR, stopSelector: STOP_BUTTON_SELECTOR },
  );
}

/** Polls until the assistant message is marked complete, generation has
 * stopped, and its text has stopped changing. False on timeout. */
async function waitForAnswerComplete(page: Page): Promise<boolean> {
  const deadline = Date.now() + RESPONSE_TIMEOUT_MS;
  let lastLength = -1;
  let stablePolls = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(POLL_INTERVAL_MS);
    const state = await readResponseState(page);
    const done = state.assistantCount > 0 && state.complete && !state.generating && state.textLength > 0;
    if (done && state.textLength === lastLength) {
      stablePolls += 1;
      if (stablePolls >= STABLE_POLLS_REQUIRED) return true;
    } else {
      stablePolls = 0;
    }
    lastLength = state.textLength;
  }
  return false;
}

/** The answer's markdown blocks (chips hidden), the raw source payloads,
 * and the message HTML for evidence. Falls back to the whole message's
 * text if ChatGPT stops marking markdown blocks. */
async function readAnswer(page: Page): Promise<{ text: string; html: string; sourcePayloads: string[] }> {
  return page.evaluate(
    ({ assistantSelector, markdownSelector, chipSelector, payloadAttribute }) => {
      const messages = document.querySelectorAll(assistantSelector);
      const message = messages[messages.length - 1] as HTMLElement | undefined;
      if (!message) return { text: "", html: "", sourcePayloads: [] };
      const sourcePayloads = [...message.querySelectorAll(`[${payloadAttribute}]`)].map(
        (element) => element.getAttribute(payloadAttribute) ?? "",
      );
      const style = document.createElement("style");
      style.textContent = `${chipSelector} { display: none !important; }`;
      document.head.appendChild(style);
      try {
        const blocks = [...message.querySelectorAll(markdownSelector)] as HTMLElement[];
        const text = (blocks.length > 0 ? blocks.map((block) => block.innerText.trim()).join("\n\n") : message.innerText).trim();
        return { text, html: message.innerHTML, sourcePayloads };
      } finally {
        style.remove();
      }
    },
    {
      assistantSelector: ASSISTANT_MESSAGE_SELECTOR,
      markdownSelector: MARKDOWN_SELECTOR,
      chipSelector: SOURCE_CHIP_SELECTOR,
      payloadAttribute: SOURCES_PAYLOAD_ATTRIBUTE,
    },
  );
}

/**
 * Asks one question in a fresh signed-out ChatGPT chat (a new tab per
 * question). Never throws — every failure returns `{ ok: false }` with a
 * user-safe message.
 */
async function askChatGptWeb(context: BrowserContext, questionText: string): Promise<AiVisibilityProviderResult> {
  let page: Page | null = null;
  try {
    page = await context.newPage();

    try {
      await page.goto(CHATGPT_WEB_URL, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    } catch {
      return failure("Could not load ChatGPT web in the browser.");
    }

    const input = page.locator(PROMPT_INPUT_SELECTOR).first();
    try {
      await input.waitFor({ state: "visible", timeout: INPUT_TIMEOUT_MS });
    } catch {
      return failure(
        describeChatGptBlockedPage(page.url(), await page.title().catch(() => "")) ??
          "Could not find ChatGPT's prompt input — the ChatGPT web interface may have changed.",
      );
    }

    // Privacy-preserving choice on the cookie banner, when shown.
    const rejectCookies = page.getByRole("button", { name: /reject non-essential/i }).first();
    if (await rejectCookies.isVisible().catch(() => false)) {
      await rejectCookies.click({ timeout: 3_000 }).catch(() => undefined);
    }

    await input.click();
    await page.keyboard.insertText(questionText);
    const typed = (await input.inputValue().catch(async () => input.innerText())).trim();
    if (typed !== questionText.trim()) {
      return failure("The question could not be entered into ChatGPT web exactly as configured.");
    }
    try {
      await page.locator(SEND_BUTTON_SELECTOR).first().click({ timeout: 5_000 });
    } catch {
      return failure("Could not find ChatGPT's send button — the ChatGPT web interface may have changed.");
    }

    if (!(await waitForAnswerComplete(page))) {
      const blocked = describeChatGptBlockedPage(page.url(), await page.title().catch(() => ""));
      return failure(blocked ?? `Timed out after ${RESPONSE_TIMEOUT_MS / 1000}s waiting for ChatGPT web to finish answering.`);
    }

    const answer = await readAnswer(page);
    if (answer.text === "") return failure("ChatGPT web returned an empty answer.");

    return {
      ok: true,
      provider: "openai",
      model: CHATGPT_WEB_MODEL,
      answerText: answer.text,
      sources: parseChatGptSourcePayloads(answer.sourcePayloads),
      usage: null,
      raw: {
        executionMethod: "browser",
        surface: "chatgpt.com",
        conversationUrl: page.url(),
        signedIn: false,
        capturedAt: new Date().toISOString(),
        sourcePayloadCount: answer.sourcePayloads.length,
        sourcePayloads: answer.sourcePayloads,
        answerHtml: answer.html.slice(0, RAW_HTML_MAX_LENGTH),
        answerHtmlTruncated: answer.html.length > RAW_HTML_MAX_LENGTH,
      },
    };
  } catch (err) {
    console.error("[ai-visibility][chatgpt-browser] question failed", {
      message: err instanceof Error ? err.message.split("\n")[0] : String(err),
    });
    return failure("The browser automation failed while asking ChatGPT web.");
  } finally {
    await page?.close().catch(() => undefined);
  }
}
