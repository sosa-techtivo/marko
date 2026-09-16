"use client";

import { useMemo, useState } from "react";
import {
  filterQuestions,
  getQuestionCategories,
  hasUncategorizedQuestions,
  UNCATEGORIZED_VALUE,
  type QuestionStatusFilter,
} from "@/lib/aiVisibility/questionFilters";
import { QuestionRow, type AiVisibilityQuestionRowData } from "./QuestionRow";

const STATUS_OPTIONS: { value: QuestionStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

/** Search/status/category management for the AI Visibility question list —
 * built for the site to comfortably hold ~50–75 tracked questions
 * (Delivery 1B), not just Delivery 1A's original handful. Purely
 * client-side: the page already loads the site's full question set, so
 * filtering the already-loaded array needs no new query and no schema
 * change. Filtering/count logic itself lives in the pure, unit-tested
 * `questionFilters.ts` — this component only owns UI state. */
export function QuestionsPanel({
  siteId,
  questions,
}: {
  siteId: string;
  questions: AiVisibilityQuestionRowData[];
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<QuestionStatusFilter>("all");
  const [category, setCategory] = useState<string | null>(null);

  const categories = useMemo(() => getQuestionCategories(questions), [questions]);
  const hasUncategorized = useMemo(() => hasUncategorizedQuestions(questions), [questions]);

  const filtered = useMemo(
    () => filterQuestions(questions, { search, status, category }),
    [questions, search, status, category],
  );

  const totalCount = questions.length;
  const activeCount = questions.filter((q) => q.isActive).length;
  const inactiveCount = totalCount - activeCount;
  const filtersApplied = search.trim() !== "" || status !== "all" || category !== null;

  if (totalCount === 0) {
    return (
      <p className="text-xs text-zinc-500">
        No questions yet. Add a handful of high-intent questions your customers might ask an AI assistant.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-zinc-500">
        <span>
          {activeCount} active &middot; {inactiveCount} inactive &middot; {totalCount} total
        </span>
        {filtersApplied && (
          <span className="font-medium text-zinc-600">
            Showing {filtered.length} of {totalCount}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor="ai-visibility-question-search" className="sr-only">
          Search questions
        </label>
        <input
          id="ai-visibility-question-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search questions…"
          className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-primary focus:ring-2 focus:ring-primary/30"
        />

        <div className="flex shrink-0 gap-1 rounded-md border border-zinc-300 bg-zinc-50 p-0.5">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setStatus(option.value)}
              aria-pressed={status === option.value}
              className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                status === option.value ? "bg-primary text-white" : "text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {(categories.length > 0 || hasUncategorized) && (
          <>
            <label htmlFor="ai-visibility-category-filter" className="sr-only">
              Filter by category
            </label>
            <select
              id="ai-visibility-category-filter"
              value={category ?? ""}
              onChange={(event) => setCategory(event.target.value === "" ? null : event.target.value)}
              className="shrink-0 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              {hasUncategorized && <option value={UNCATEGORIZED_VALUE}>Uncategorized</option>}
            </select>
          </>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-zinc-500">No questions match the current search/filters.</p>
      ) : (
        <ul className="flex max-h-[32rem] flex-col gap-1.5 overflow-y-auto pr-1">
          {filtered.map((question) => (
            <QuestionRow key={question.id} siteId={siteId} question={question} />
          ))}
        </ul>
      )}
    </div>
  );
}
