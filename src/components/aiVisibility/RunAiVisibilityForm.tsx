"use client";

import {
  runApiAiVisibilityAnalysis,
  runBrowserAiVisibilityAnalysis,
} from "@/app/dashboard/sites/[slug]/ai-visibility/actions";
import { SubmitButton } from "./SubmitButton";

const BUTTON_CLASS_NAME =
  "shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

/** Starts one AI Visibility run synchronously — same "manual, in-request"
 * posture as the SEO report's "Run SEO analysis" button. Two separate
 * forms, each bound to its own Server Action, so a button can only ever
 * trigger its own acquisition method (API vs Browser). */
export function RunAiVisibilityForm({ siteId }: { siteId: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={runApiAiVisibilityAnalysis}>
        <input type="hidden" name="siteId" value={siteId} />
        <SubmitButton pendingLabel="Analyzing via API…" className={BUTTON_CLASS_NAME}>
          Run API AI Visibility analysis
        </SubmitButton>
      </form>
      <form action={runBrowserAiVisibilityAnalysis}>
        <input type="hidden" name="siteId" value={siteId} />
        <SubmitButton pendingLabel="Analyzing via browser…" className={BUTTON_CLASS_NAME}>
          Run Browser AI Visibility analysis
        </SubmitButton>
      </form>
    </div>
  );
}
