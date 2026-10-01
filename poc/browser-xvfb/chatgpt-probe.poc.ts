/**
 * Browser-worker feasibility POC (not part of the app; see README.md).
 * Asks ONE question through MARKO's real, unmodified ChatGPT Browser provider
 * (src/lib/aiVisibility/providers/chatgptBrowser.ts) and reports what happened,
 * how long it took, and peak Chrome memory. Headed vs headless is chosen only
 * through the provider's existing CHATGPT_BROWSER_HEADLESS variable; on Linux,
 * headed mode runs inside `xvfb-run` (a virtual X display), so no window is
 * shown anywhere.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { openChatGptBrowserSession } from "@/lib/aiVisibility/providers/chatgptBrowser";

const QUESTION = "Which software development companies in Colombia should I consider for a new digital product?";

/** Sum of resident memory (MB) of the Chrome processes Playwright launched
 * (identified by its temporary profile directory), so a user's own Chrome
 * is never counted. */
function chromeRssMb(): number {
  try {
    const out = execFileSync("ps", ["-A", "-ww", "-o", "rss=,args="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    let kb = 0;
    for (const line of out.split("\n")) {
      const match = line.trim().match(/^(\d+)\s+(.*)$/);
      if (match && /playwright_chromiumdev_profile/.test(match[2])) kb += Number(match[1]);
    }
    return Math.round(kb / 1024);
  } catch {
    return -1;
  }
}

it("ChatGPT Browser provider — one real question", async () => {
  const baselineMb = chromeRssMb();
  let peakMb = baselineMb;
  const sampler = setInterval(() => {
    peakMb = Math.max(peakMb, chromeRssMb());
  }, 500);
  const started = Date.now();
  let report: Record<string, unknown>;
  try {
    const opened = await openChatGptBrowserSession();
    if (!opened.ok) {
      report = { status: "launch-failed", error: opened.error };
    } else {
      try {
        const result = await opened.session.ask(QUESTION);
        report = result.ok
          ? {
              status: "completed",
              model: result.model,
              answerChars: result.answerText.length,
              answerStart: result.answerText.slice(0, 200),
              uniqueSources: new Set(result.sources.map((source) => source.url)).size,
              conversationUrl: (result.raw as Record<string, unknown>).conversationUrl,
            }
          : { status: "failed", error: result.error };
      } finally {
        await opened.session.close();
      }
    }
  } finally {
    clearInterval(sampler);
  }
  const output = {
    mode: process.env.POC_MODE ?? "unspecified",
    platform: `${process.platform}/${process.arch}`,
    display: process.env.DISPLAY ?? null,
    headless: process.env.CHATGPT_BROWSER_HEADLESS === "true",
    seconds: Math.round((Date.now() - started) / 1000),
    chromeBaselineMb: baselineMb,
    chromePeakMb: peakMb,
    chromePeakDeltaMb: peakMb - baselineMb,
    ...report,
  };
  console.log(`POC_RESULT ${JSON.stringify(output)}`);
  if (process.env.POC_OUTPUT) writeFileSync(process.env.POC_OUTPUT, JSON.stringify(output, null, 1));
}, 300_000);
