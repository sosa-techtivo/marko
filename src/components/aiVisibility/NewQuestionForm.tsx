"use client";

import { createAiVisibilityQuestion } from "@/app/dashboard/sites/[slug]/ai-visibility/actions";
import { SubmitButton } from "./SubmitButton";

/** Adds one AI Visibility question. Deliberately just a question-text
 * field plus a free-text category field — no bulk import, no templates,
 * no AI-generated question sets (explicitly out of scope for this
 * slice). The Server Action redirects back to this same page on success,
 * which remounts the form with empty fields — no manual reset needed. */
export function NewQuestionForm({ siteId }: { siteId: string }) {
  return (
    <form action={createAiVisibilityQuestion} className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <input type="hidden" name="siteId" value={siteId} />
      <div className="flex-1">
        <label htmlFor="questionText" className="sr-only">
          Question
        </label>
        <input
          id="questionText"
          name="questionText"
          required
          placeholder="e.g. Who are the best providers of X in [market]?"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-primary focus:ring-2 focus:ring-primary/30"
        />
      </div>
      <div className="sm:w-40">
        <label htmlFor="category" className="sr-only">
          Category
        </label>
        <input
          id="category"
          name="category"
          placeholder="Category (optional)"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-primary focus:ring-2 focus:ring-primary/30"
        />
      </div>
      <SubmitButton
        pendingLabel="Adding…"
        className="shrink-0 rounded-md bg-primary px-3 py-2 text-xs font-medium text-white hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Add question
      </SubmitButton>
    </form>
  );
}
