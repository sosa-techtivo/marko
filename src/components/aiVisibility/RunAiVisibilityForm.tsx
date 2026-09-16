"use client";

import { runAiVisibilityAnalysis } from "@/app/dashboard/sites/[slug]/ai-visibility/actions";
import { SubmitButton } from "./SubmitButton";

/** Starts one AI Visibility run synchronously — same "manual, in-request"
 * posture as the SEO report's "Run SEO analysis" button. This slice's
 * volume (~5–10 active questions) makes a plain form submit + redirect an
 * acceptable UX; no queue/scheduling is introduced here. */
export function RunAiVisibilityForm({ siteId }: { siteId: string }) {
  return (
    <form action={runAiVisibilityAnalysis}>
      <input type="hidden" name="siteId" value={siteId} />
      <SubmitButton
        pendingLabel="Analyzing…"
        className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Run AI Visibility analysis
      </SubmitButton>
    </form>
  );
}
