import { describe, expect, it } from "vitest";
import {
  filterQuestions,
  getQuestionCategories,
  hasUncategorizedQuestions,
  UNCATEGORIZED_VALUE,
  type FilterableQuestion,
} from "./questionFilters";

const questions: FilterableQuestion[] = [
  { questionText: "Who offers the best auto loans?", category: "Loans", isActive: true },
  { questionText: "What is the best credit union near me?", category: "Loans", isActive: false },
  { questionText: "Best mortgage rates today?", category: "Mortgages", isActive: true },
  { questionText: "How do I open a savings account?", category: null, isActive: true },
  { questionText: "  ", category: "  ", isActive: false },
];

describe("getQuestionCategories", () => {
  it("returns distinct categories, sorted case-insensitively", () => {
    expect(getQuestionCategories(questions)).toEqual(["Loans", "Mortgages"]);
  });

  it("excludes null/blank categories", () => {
    const cats = getQuestionCategories([{ questionText: "x", category: null, isActive: true }]);
    expect(cats).toEqual([]);
  });
});

describe("hasUncategorizedQuestions", () => {
  it("is true when at least one question has no category", () => {
    expect(hasUncategorizedQuestions(questions)).toBe(true);
  });

  it("is false when every question has a category", () => {
    expect(hasUncategorizedQuestions([{ questionText: "x", category: "Loans", isActive: true }])).toBe(false);
  });

  it("treats a blank/whitespace-only category as uncategorized", () => {
    expect(hasUncategorizedQuestions([{ questionText: "x", category: "   ", isActive: true }])).toBe(true);
  });
});

describe("filterQuestions", () => {
  it("returns everything when filters are empty/default", () => {
    expect(filterQuestions(questions, { search: "", status: "all", category: null })).toHaveLength(5);
  });

  it("matches question text case-insensitively", () => {
    const result = filterQuestions(questions, { search: "MORTGAGE", status: "all", category: null });
    expect(result.map((q) => q.questionText)).toEqual(["Best mortgage rates today?"]);
  });

  it("restores the full list when search is cleared", () => {
    const filtered = filterQuestions(questions, { search: "mortgage", status: "all", category: null });
    expect(filtered).toHaveLength(1);
    const cleared = filterQuestions(questions, { search: "", status: "all", category: null });
    expect(cleared).toHaveLength(5);
  });

  it("filters to only active questions", () => {
    const result = filterQuestions(questions, { search: "", status: "active", category: null });
    expect(result.every((q) => q.isActive)).toBe(true);
    expect(result).toHaveLength(3);
  });

  it("filters to only inactive questions", () => {
    const result = filterQuestions(questions, { search: "", status: "inactive", category: null });
    expect(result.every((q) => !q.isActive)).toBe(true);
    expect(result).toHaveLength(2);
  });

  it("filters by an existing category", () => {
    const result = filterQuestions(questions, { search: "", status: "all", category: "Loans" });
    expect(result).toHaveLength(2);
    expect(result.every((q) => q.category === "Loans")).toBe(true);
  });

  it("filters to uncategorized questions via the sentinel value", () => {
    const result = filterQuestions(questions, { search: "", status: "all", category: UNCATEGORIZED_VALUE });
    expect(result).toHaveLength(2);
  });

  it("composes search, status, and category filters together", () => {
    const result = filterQuestions(questions, { search: "best", status: "active", category: "Loans" });
    expect(result.map((q) => q.questionText)).toEqual(["Who offers the best auto loans?"]);
  });

  it("returns an empty list when nothing matches", () => {
    const result = filterQuestions(questions, { search: "nonexistent question", status: "all", category: null });
    expect(result).toEqual([]);
  });
});
