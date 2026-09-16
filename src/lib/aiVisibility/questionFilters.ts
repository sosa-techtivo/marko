/**
 * Pure client-side search/filter helpers for the AI Visibility Questions
 * list (Delivery 1B — question management at 50–75 question scale). No
 * database query changes: the page already loads a site's full question
 * set, and at that volume filtering the already-loaded array is cheap and
 * avoids introducing new server round-trips for every keystroke.
 */

export type QuestionStatusFilter = "all" | "active" | "inactive";

export type FilterableQuestion = {
  category: string | null;
  isActive: boolean;
  questionText: string;
};

/** Sentinel category value meaning "no category set" — distinct from any
 * real free-text category string a user could type. */
export const UNCATEGORIZED_VALUE = "__uncategorized__";

export type QuestionFilters = {
  search: string;
  status: QuestionStatusFilter;
  /** null = all categories. */
  category: string | null;
};

function isUncategorized(category: string | null): boolean {
  return category === null || category.trim() === "";
}

/** Distinct, sorted (case-insensitive) category values actually present on
 * the given questions. Excludes uncategorized questions — that case is
 * handled separately via `UNCATEGORIZED_VALUE` since it isn't a real
 * category string. */
export function getQuestionCategories(questions: FilterableQuestion[]): string[] {
  const categories = new Set<string>();
  for (const question of questions) {
    if (!isUncategorized(question.category)) {
      categories.add(question.category as string);
    }
  }
  return [...categories].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function hasUncategorizedQuestions(questions: FilterableQuestion[]): boolean {
  return questions.some((question) => isUncategorized(question.category));
}

export function filterQuestions<T extends FilterableQuestion>(questions: T[], filters: QuestionFilters): T[] {
  const search = filters.search.trim().toLowerCase();

  return questions.filter((question) => {
    if (filters.status === "active" && !question.isActive) return false;
    if (filters.status === "inactive" && question.isActive) return false;

    if (filters.category !== null) {
      if (filters.category === UNCATEGORIZED_VALUE) {
        if (!isUncategorized(question.category)) return false;
      } else if (question.category !== filters.category) {
        return false;
      }
    }

    if (search !== "" && !question.questionText.toLowerCase().includes(search)) return false;

    return true;
  });
}
