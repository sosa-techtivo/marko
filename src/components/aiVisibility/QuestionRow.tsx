"use client";

import { useState } from "react";
import {
  setAiVisibilityQuestionActive,
  updateAiVisibilityQuestion,
} from "@/app/dashboard/sites/[slug]/ai-visibility/actions";
import { SubmitButton } from "./SubmitButton";

export type AiVisibilityQuestionRowData = {
  id: string;
  questionText: string;
  category: string | null;
  isActive: boolean;
};

export function QuestionRow({ siteId, question }: { siteId: string; question: AiVisibilityQuestionRowData }) {
  const [isEditing, setIsEditing] = useState(false);

  if (isEditing) {
    return (
      <li className="rounded-md border border-primary/30 bg-primary-tint/30 p-3">
        <form
          action={updateAiVisibilityQuestion}
          className="flex flex-col gap-2 sm:flex-row sm:items-start"
        >
          <input type="hidden" name="siteId" value={siteId} />
          <input type="hidden" name="questionId" value={question.id} />
          <div className="flex-1">
            <label htmlFor={`edit-question-${question.id}`} className="sr-only">
              Question
            </label>
            <input
              id={`edit-question-${question.id}`}
              name="questionText"
              required
              defaultValue={question.questionText}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="sm:w-40">
            <label htmlFor={`edit-category-${question.id}`} className="sr-only">
              Category
            </label>
            <input
              id={`edit-category-${question.id}`}
              name="category"
              defaultValue={question.category ?? ""}
              placeholder="Category (optional)"
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="rounded-md border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Cancel
            </button>
            <SubmitButton
              pendingLabel="Saving…"
              className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-white hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Save
            </SubmitButton>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li
      className={`flex flex-col gap-2 rounded-md border border-zinc-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between ${
        question.isActive ? "" : "opacity-60"
      }`}
    >
      <div className="min-w-0">
        <p className="text-xs font-medium text-zinc-900">{question.questionText}</p>
        <div className="mt-1 flex items-center gap-1.5">
          {question.category && (
            <span className="inline-block rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
              {question.category}
            </span>
          )}
          {!question.isActive && (
            <span className="inline-block rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
              Inactive
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Edit
        </button>
        <form action={setAiVisibilityQuestionActive}>
          <input type="hidden" name="siteId" value={siteId} />
          <input type="hidden" name="questionId" value={question.id} />
          <input type="hidden" name="isActive" value={(!question.isActive).toString()} />
          <SubmitButton
            pendingLabel="…"
            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {question.isActive ? "Deactivate" : "Reactivate"}
          </SubmitButton>
        </form>
      </div>
    </li>
  );
}
