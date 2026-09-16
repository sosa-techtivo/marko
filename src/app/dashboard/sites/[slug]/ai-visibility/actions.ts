"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUserAndOrganization } from "@/lib/organizations";
import { runAiVisibility } from "@/lib/aiVisibility/runAiVisibility";
import type { AiVisibilitySource } from "@/lib/aiVisibility/providers/types";
import { siteAiVisibilityPath } from "@/lib/sites/paths";

const AI_VISIBILITY_PROVIDER = "openai";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** Same explicit (organization_id, site_id) double-check every other
 * site-scoped action in this project already uses on top of RLS (see
 * resolveSite.ts / getCrawlRunDetail) — a site outside the caller's
 * organization is treated identically to a nonexistent one. */
async function requireOwnedSite(supabase: SupabaseServerClient, organizationId: string, siteId: string) {
  const { data: site } = await supabase
    .from("sites")
    .select("id, name, url, effective_url, slug")
    .eq("id", siteId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  return site ?? null;
}

export async function createAiVisibilityQuestion(formData: FormData) {
  const siteId = String(formData.get("siteId") ?? "").trim();
  const questionText = String(formData.get("questionText") ?? "").trim();
  const categoryRaw = String(formData.get("category") ?? "").trim();

  const { organization } = await requireUserAndOrganization();
  if (!organization || !siteId) redirect("/dashboard");

  const supabase = await createClient();
  const site = await requireOwnedSite(supabase, organization.id, siteId);
  if (!site) redirect("/dashboard?error=site-not-found");

  if (questionText === "") {
    redirect(`${siteAiVisibilityPath(site.slug)}?error=question-required`);
  }

  const { error } = await supabase.from("ai_visibility_questions").insert({
    site_id: site.id,
    organization_id: organization.id,
    question_text: questionText,
    category: categoryRaw === "" ? null : categoryRaw,
  });

  if (error) {
    console.error("[createAiVisibilityQuestion] insert failed", {
      code: error.code,
      message: error.message,
    });
    redirect(`${siteAiVisibilityPath(site.slug)}?error=question-save-failed`);
  }

  redirect(siteAiVisibilityPath(site.slug));
}

export async function updateAiVisibilityQuestion(formData: FormData) {
  const siteId = String(formData.get("siteId") ?? "").trim();
  const questionId = String(formData.get("questionId") ?? "").trim();
  const questionText = String(formData.get("questionText") ?? "").trim();
  const categoryRaw = String(formData.get("category") ?? "").trim();

  const { organization } = await requireUserAndOrganization();
  if (!organization || !siteId || !questionId) redirect("/dashboard");

  const supabase = await createClient();
  const site = await requireOwnedSite(supabase, organization.id, siteId);
  if (!site) redirect("/dashboard?error=site-not-found");

  if (questionText === "") {
    redirect(`${siteAiVisibilityPath(site.slug)}?error=question-required`);
  }

  const { error } = await supabase
    .from("ai_visibility_questions")
    .update({
      question_text: questionText,
      category: categoryRaw === "" ? null : categoryRaw,
      updated_at: new Date().toISOString(),
    })
    .eq("id", questionId)
    .eq("organization_id", organization.id)
    .eq("site_id", site.id);

  if (error) {
    console.error("[updateAiVisibilityQuestion] update failed", {
      code: error.code,
      message: error.message,
    });
    redirect(`${siteAiVisibilityPath(site.slug)}?error=question-save-failed`);
  }

  redirect(siteAiVisibilityPath(site.slug));
}

/** The "remove" path for a question: deactivate (or reactivate), never a
 * hard delete — preserves any ai_visibility_results rows that already
 * reference it, the same archive-don't-delete posture
 * 0006_site_archive.sql established for sites. */
export async function setAiVisibilityQuestionActive(formData: FormData) {
  const siteId = String(formData.get("siteId") ?? "").trim();
  const questionId = String(formData.get("questionId") ?? "").trim();
  const isActive = formData.get("isActive") === "true";

  const { organization } = await requireUserAndOrganization();
  if (!organization || !siteId || !questionId) redirect("/dashboard");

  const supabase = await createClient();
  const site = await requireOwnedSite(supabase, organization.id, siteId);
  if (!site) redirect("/dashboard?error=site-not-found");

  const { error } = await supabase
    .from("ai_visibility_questions")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", questionId)
    .eq("organization_id", organization.id)
    .eq("site_id", site.id);

  if (error) {
    console.error("[setAiVisibilityQuestionActive] update failed", {
      code: error.code,
      message: error.message,
    });
  }

  redirect(siteAiVisibilityPath(site.slug));
}

/**
 * Starts and runs one AI Visibility analysis synchronously within this
 * Server Action request — acceptable for this slice's deliberately small
 * volume (~5–10 active questions), same "manual, in-request" posture
 * runSeoAnalysis already has for the SEO crawl. No queue/worker/scheduling
 * is introduced here (see CLAUDE.md's explicit Delivery 1A scope).
 *
 * A missing OPENAI_API_KEY/OPENAI_MODEL is checked once, up front, and
 * recorded as a single failed run with a clear top-level error — rather
 * than attempting every question only to have each one fail identically,
 * which would just be N duplicate rows saying the same thing.
 */
export async function runAiVisibilityAnalysis(formData: FormData) {
  const siteId = String(formData.get("siteId") ?? "").trim();
  if (!siteId) redirect("/dashboard");

  const { user, organization } = await requireUserAndOrganization();
  if (!organization) redirect("/dashboard");

  const supabase = await createClient();
  const site = await requireOwnedSite(supabase, organization.id, siteId);
  if (!site) redirect("/dashboard?error=site-not-found");

  const model = process.env.OPENAI_MODEL ?? "unknown";

  const { data: questions, error: questionsError } = await supabase
    .from("ai_visibility_questions")
    .select("id, question_text")
    .eq("site_id", site.id)
    .eq("organization_id", organization.id)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (questionsError) {
    console.error("[runAiVisibilityAnalysis] failed to load active questions", {
      code: questionsError.code,
      message: questionsError.message,
    });
    redirect(`${siteAiVisibilityPath(site.slug)}?error=run-start-failed`);
  }

  if (!questions || questions.length === 0) {
    redirect(`${siteAiVisibilityPath(site.slug)}?error=no-active-questions`);
  }

  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL) {
    const { error: insertUnconfiguredRunError } = await supabase.from("ai_visibility_runs").insert({
      site_id: site.id,
      organization_id: organization.id,
      triggered_by: user.id,
      status: "failed",
      provider: AI_VISIBILITY_PROVIDER,
      model,
      completed_at: new Date().toISOString(),
      question_count: 0,
      succeeded_count: 0,
      failed_count: 0,
      error_message: "AI Visibility is not configured: set OPENAI_API_KEY and OPENAI_MODEL (see .env.example).",
    });
    if (insertUnconfiguredRunError) {
      console.error("[runAiVisibilityAnalysis] failed to record unconfigured run", {
        code: insertUnconfiguredRunError.code,
        message: insertUnconfiguredRunError.message,
      });
    }
    redirect(siteAiVisibilityPath(site.slug));
  }

  const { data: run, error: insertRunError } = await supabase
    .from("ai_visibility_runs")
    .insert({
      site_id: site.id,
      organization_id: organization.id,
      triggered_by: user.id,
      status: "running",
      provider: AI_VISIBILITY_PROVIDER,
      model,
      question_count: questions.length,
    })
    .select("id")
    .single();

  if (insertRunError || !run) {
    console.error("[runAiVisibilityAnalysis] failed to create run", {
      code: insertRunError?.code,
      message: insertRunError?.message,
    });
    redirect(`${siteAiVisibilityPath(site.slug)}?error=run-start-failed`);
  }

  const siteUrl = site.effective_url ?? site.url;
  const outcomes = await runAiVisibility(
    questions.map((q) => ({ id: q.id, questionText: q.question_text })),
    siteUrl,
    site.name,
  );

  const resultsToInsert = outcomes.map((outcome) =>
    outcome.status === "completed"
      ? {
          run_id: run.id,
          question_id: outcome.questionId,
          organization_id: organization.id,
          status: "completed",
          provider: outcome.provider,
          model: outcome.model,
          answer_text: outcome.answerText,
          sources: outcome.sources,
          mentioned: outcome.mentioned,
          cited: outcome.cited,
          first_mention_index: outcome.firstMentionIndex,
          usage: outcome.usage,
          raw_response: outcome.raw,
        }
      : {
          run_id: run.id,
          question_id: outcome.questionId,
          organization_id: organization.id,
          status: "failed",
          provider: outcome.provider,
          model: outcome.model,
          error_message: outcome.errorMessage,
        },
  );

  // One bulk insert covering every question's outcome — success and
  // failure rows together — so a partial-failure run never has a window
  // where a successful question's evidence exists without the rest of the
  // run's results, and a failing question never blocks a sibling
  // success's row from being written.
  const { error: insertResultsError } = await supabase.from("ai_visibility_results").insert(resultsToInsert);

  if (insertResultsError) {
    console.error("[runAiVisibilityAnalysis] failed to persist results", {
      code: insertResultsError.code,
      message: insertResultsError.message,
      details: insertResultsError.details,
      hint: insertResultsError.hint,
    });
    await supabase
      .from("ai_visibility_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: "The analysis completed but its results could not be saved.",
      })
      .eq("id", run.id);
    redirect(siteAiVisibilityPath(site.slug));
  }

  const succeededCount = outcomes.filter((outcome) => outcome.status === "completed").length;
  const failedCount = outcomes.length - succeededCount;

  const { error: completeError } = await supabase
    .from("ai_visibility_runs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      succeeded_count: succeededCount,
      failed_count: failedCount,
    })
    .eq("id", run.id);

  if (completeError) {
    console.error("[runAiVisibilityAnalysis] failed to mark run completed", {
      code: completeError.code,
      message: completeError.message,
    });
  }

  redirect(siteAiVisibilityPath(site.slug));
}

export type AiVisibilityResultDetail = {
  id: string;
  questionId: string;
  questionText: string;
  category: string | null;
  status: string;
  answerText: string | null;
  sources: AiVisibilitySource[];
  mentioned: boolean | null;
  cited: boolean | null;
  firstMentionIndex: number | null;
  errorMessage: string | null;
  createdAt: string;
};

export type AiVisibilityRunDetailResult =
  | {
      ok: true;
      run: {
        id: string;
        status: string;
        provider: string;
        model: string;
        startedAt: string;
        completedAt: string | null;
        errorMessage: string | null;
        questionCount: number;
        succeededCount: number;
        failedCount: number;
      };
      results: AiVisibilityResultDetail[];
    }
  | { ok: false; error: string };

/**
 * Loads one historical run's persisted results for the AI Visibility
 * history detail view — reads only, never re-executes anything. Same
 * tenant double-check as getCrawlRunDetail: the run lookup is scoped to
 * both `siteId` and the caller's own `organization.id`.
 */
export async function getAiVisibilityRunDetail(
  siteId: string,
  runId: string,
): Promise<AiVisibilityRunDetailResult> {
  const { organization } = await requireUserAndOrganization();
  if (!organization) {
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  const supabase = await createClient();

  const { data: run } = await supabase
    .from("ai_visibility_runs")
    .select(
      "id, status, provider, model, started_at, completed_at, error_message, question_count, succeeded_count, failed_count",
    )
    .eq("id", runId)
    .eq("site_id", siteId)
    .eq("organization_id", organization.id)
    .maybeSingle();

  if (!run) {
    return { ok: false, error: "That analysis could not be found." };
  }

  const { data: results } = await supabase
    .from("ai_visibility_results")
    .select("id, question_id, status, answer_text, sources, mentioned, cited, first_mention_index, error_message, created_at")
    .eq("run_id", run.id)
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: true });

  const questionIds = [...new Set((results ?? []).map((result) => result.question_id))];
  const { data: questions } =
    questionIds.length > 0
      ? await supabase
          .from("ai_visibility_questions")
          .select("id, question_text, category")
          .in("id", questionIds)
          .eq("organization_id", organization.id)
      : { data: [] as { id: string; question_text: string; category: string | null }[] };

  const questionById = new Map((questions ?? []).map((question) => [question.id, question]));

  return {
    ok: true,
    run: {
      id: run.id,
      status: run.status,
      provider: run.provider,
      model: run.model,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      errorMessage: run.error_message,
      questionCount: run.question_count,
      succeededCount: run.succeeded_count,
      failedCount: run.failed_count,
    },
    results: (results ?? []).map((result) => ({
      id: result.id,
      questionId: result.question_id,
      questionText: questionById.get(result.question_id)?.question_text ?? "(question no longer available)",
      category: questionById.get(result.question_id)?.category ?? null,
      status: result.status,
      answerText: result.answer_text,
      sources: (result.sources ?? []) as AiVisibilitySource[],
      mentioned: result.mentioned,
      cited: result.cited,
      firstMentionIndex: result.first_mention_index,
      errorMessage: result.error_message,
      createdAt: result.created_at,
    })),
  };
}
