import { describe, expect, it, vi } from "vitest";
import { loadAiVisibilityResultDetail, pickEvidenceFields } from "./resultDetail";
import { summarizeAiVisibilityResult } from "./resultSummary";

type Response = { data: unknown };

/** Minimal per-table fake of the supabase-js chain; records .eq filters. */
function fakeSupabase(responses: Record<string, Response>) {
  const filters: { table: string; column: string; value: unknown }[] = [];
  function from(table: string) {
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters.push({ table, column, value });
        return chain;
      },
      maybeSingle: async () => responses[table] ?? { data: null },
    };
    return chain;
  }
  return { client: { from: vi.fn(from) } as never, filters };
}

const SITE = { id: "site-1", name: "Techtivo", url: "https://techtivo.com", effective_url: null };

const GEMINI_ROW = {
  id: "res-gemini",
  run_id: "run-1",
  question_id: "q1",
  provider: "gemini",
  model: "gemini-web (Flash-Lite)",
  execution_method: "browser",
  status: "completed",
  answer_text: "Gemini's own full answer.",
  sources: [
    { url: "https://clutch.co/co", title: "Clutch", domain: "clutch.co", startIndex: null, endIndex: null },
    { url: "https://clutch.co/co", title: "Clutch", domain: "clutch.co", startIndex: null, endIndex: null },
  ],
  raw_response: {
    surface: "gemini.google.com",
    signedIn: false,
    answerHtml: '<ul><li><p><b>Leanware</b> (Bogotá) – Product studio.</p></li></ul>',
    citationLinks: [{ href: "https://clutch.co/co" }],
  },
  mentioned: false,
  cited: false,
  first_mention_index: null,
  error_message: null,
};

describe("loadAiVisibilityResultDetail", () => {
  it("returns only the requested provider's own answer, KPIs and competitors", async () => {
    const { client } = fakeSupabase({
      ai_visibility_results: { data: GEMINI_ROW },
      ai_visibility_runs: { data: { id: "run-1", started_at: "2026-10-01T15:00:00Z" } },
      ai_visibility_questions: { data: { question_text: "Which companies?", category: null } },
    });

    const detail = await loadAiVisibilityResultDetail(client, "org-1", SITE, "res-gemini");

    expect(detail).toEqual(
      expect.objectContaining({
        id: "res-gemini",
        provider: "gemini",
        answerText: "Gemini's own full answer.",
        competitors: ["Leanware"],
        sourceCount: 1,
        questionText: "Which companies?",
      }),
    );
  });

  it("scopes the result to the caller's organization and its run to the requested site", async () => {
    const { client, filters } = fakeSupabase({
      ai_visibility_results: { data: GEMINI_ROW },
      ai_visibility_runs: { data: { id: "run-1", started_at: "2026-10-01T15:00:00Z" } },
    });

    await loadAiVisibilityResultDetail(client, "org-1", SITE, "res-gemini");

    expect(filters).toEqual(
      expect.arrayContaining([
        { table: "ai_visibility_results", column: "organization_id", value: "org-1" },
        { table: "ai_visibility_runs", column: "site_id", value: "site-1" },
        { table: "ai_visibility_runs", column: "organization_id", value: "org-1" },
      ]),
    );
  });

  it("returns null when the result's run belongs to a different site (or doesn't exist)", async () => {
    const { client } = fakeSupabase({ ai_visibility_results: { data: GEMINI_ROW }, ai_visibility_runs: { data: null } });
    expect(await loadAiVisibilityResultDetail(client, "org-1", SITE, "res-gemini")).toBeNull();
  });

  it("returns null when the result isn't in the caller's organization", async () => {
    const { client } = fakeSupabase({ ai_visibility_results: { data: null } });
    expect(await loadAiVisibilityResultDetail(client, "org-1", SITE, "res-other")).toBeNull();
  });
});

describe("pickEvidenceFields", () => {
  it("shows only allowlisted primitive evidence — never the answer HTML or source payload dumps", () => {
    const fields = pickEvidenceFields(GEMINI_ROW.raw_response);
    expect(fields).toEqual([
      { label: "Surface", value: "gemini.google.com" },
      { label: "Signed in", value: "No" },
    ]);
    expect(JSON.stringify(fields)).not.toContain("answerHtml");
  });
});

describe("summarizeAiVisibilityResult", () => {
  it("never produces KPI values for a failed result", () => {
    expect(
      summarizeAiVisibilityResult(
        { status: "failed", answer_text: null, sources: [], raw_response: null },
        { brandName: "Techtivo", siteUrl: "https://techtivo.com" },
      ),
    ).toEqual({ competitors: null, sourceCount: null });
  });
});
