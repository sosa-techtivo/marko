import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUserAndOrganization } from "@/lib/organizations";
import { resolveSiteBySlug } from "../resolveSite";
import { siteDetailPath } from "@/lib/sites/paths";
import { NewQuestionForm } from "@/components/aiVisibility/NewQuestionForm";
import type { AiVisibilityQuestionRowData } from "@/components/aiVisibility/QuestionRow";
import { QuestionsPanel } from "@/components/aiVisibility/QuestionsPanel";
import { RunAiVisibilityForm } from "@/components/aiVisibility/RunAiVisibilityForm";
import { AiVisibilityRunHistory, type AiVisibilityHistoryRun } from "@/components/aiVisibility/AiVisibilityRunHistory";

// Executed synchronously within this request, batched at low concurrency
// over a deliberately small question set (~5–10) — see
// runAiVisibility.ts's EXECUTION_CONCURRENCY. Generously larger than the
// SEO crawl's 60s budget since a web-search-enabled provider call can take
// meaningfully longer than a single page fetch; actual enforcement depends
// on the hosting plan (see PROJECT_STATUS.md's known limitations —
// scheduling/background execution is explicitly deferred to Delivery 4).
export const maxDuration = 180;

const ERROR_MESSAGES: Record<string, string> = {
  "question-required": "Please enter a question.",
  "question-save-failed": "Something went wrong saving that question. Please try again.",
  "no-active-questions": "Add at least one active question before running an analysis.",
  "run-start-failed": "Could not start the AI Visibility analysis. Please try again.",
};

export default async function AiVisibilityPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const { error } = await searchParams;
  const { organization } = await requireUserAndOrganization();

  if (!organization) {
    notFound();
  }

  const supabase = await createClient();
  const site = await resolveSiteBySlug(supabase, organization.id, slug);

  if (!site) {
    notFound();
  }

  const { data: questions } = await supabase
    .from("ai_visibility_questions")
    .select("id, question_text, category, is_active")
    .eq("site_id", site.id)
    .order("created_at", { ascending: true });

  const { data: runs } = await supabase
    .from("ai_visibility_runs")
    .select("id, status, started_at, question_count, succeeded_count, failed_count, error_message")
    .eq("site_id", site.id)
    .order("started_at", { ascending: false })
    .limit(10);

  const questionRows: AiVisibilityQuestionRowData[] = (questions ?? []).map((q) => ({
    id: q.id,
    questionText: q.question_text,
    category: q.category,
    isActive: q.is_active,
  }));

  const historyRuns: AiVisibilityHistoryRun[] = (runs ?? []).map((r) => ({
    id: r.id,
    status: r.status,
    startedAt: r.started_at,
    questionCount: r.question_count,
    succeededCount: r.succeeded_count,
    failedCount: r.failed_count,
    errorMessage: r.error_message,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
          <Link href={siteDetailPath(site.slug)} className="shrink-0 text-zinc-500 hover:text-primary-strong">
            ← Back to {site.name}
          </Link>
          <span className="shrink-0 text-zinc-300" aria-hidden="true">
            |
          </span>
          <h1 className="min-w-0 truncate font-semibold text-zinc-900">AI Visibility</h1>
        </div>
        <RunAiVisibilityForm siteId={site.id} />
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {ERROR_MESSAGES[error] ?? "Something went wrong. Please try again."}
        </p>
      )}

      <p className="text-xs text-zinc-500">
        MARKO measures how OpenAI answers real customer questions about {site.name} when it can search the
        live web — a first look at AI search visibility, alongside MARKO&apos;s existing SEO analysis. This is
        a small first slice: OpenAI only, and only the Mentioned/Cited/first-mention metrics below are
        measured today.
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="text-xs font-semibold text-zinc-900">Questions</h2>
          <NewQuestionForm siteId={site.id} />
          <QuestionsPanel siteId={site.id} questions={questionRows} />
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="text-xs font-semibold text-zinc-900">AI Visibility runs</h2>
          <AiVisibilityRunHistory siteId={site.id} runs={historyRuns} />
        </div>
      </div>
    </div>
  );
}
