import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUserAndOrganization } from "@/lib/organizations";
import { resolveSiteBySlug } from "../../../resolveSite";
import { siteAiVisibilityPath } from "@/lib/sites/paths";
import { loadAiVisibilityResultDetail } from "@/lib/aiVisibility/resultDetail";
import { aiVisibilityProviderLabel } from "@/lib/aiVisibility/providerLabels";
import { ExecutionMethodBadge } from "@/components/aiVisibility/ExecutionMethodBadge";
import { MetricBadge } from "@/components/aiVisibility/MetricBadge";

/** One provider's result for one question — the full captured answer,
 * its sources and competitors, and safe technical evidence. Opened from the
 * run detail modal's "View details"; the modal itself only shows KPIs. */
export default async function AiVisibilityResultDetailPage({
  params,
}: {
  params: Promise<{ slug: string; resultId: string }>;
}) {
  const { slug, resultId } = await params;
  const { organization } = await requireUserAndOrganization();
  if (!organization) notFound();

  const supabase = await createClient();
  const site = await resolveSiteBySlug(supabase, organization.id, slug);
  if (!site) notFound();

  const detail = await loadAiVisibilityResultDetail(supabase, organization.id, site, resultId);
  if (!detail) notFound();

  const providerLabel = aiVisibilityProviderLabel(detail.provider, detail.executionMethod);
  const failed = detail.status !== "completed";
  const backHref = `${siteAiVisibilityPath(site.slug)}?run=${detail.runId}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
        <Link href={backHref} className="shrink-0 text-zinc-500 hover:text-primary-strong">
          ← Back to AI Visibility run
        </Link>
        <span className="shrink-0 text-zinc-300" aria-hidden="true">
          |
        </span>
        <h1 className="min-w-0 truncate font-semibold text-zinc-900">{providerLabel} result</h1>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-900">{detail.questionText}</p>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
              <span>Run started {new Date(detail.runStartedAt).toLocaleString()}</span>
              <ExecutionMethodBadge method={detail.executionMethod} />
              {detail.category && (
                <span className="rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5">{detail.category}</span>
              )}
            </p>
          </div>
          <span
            className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${
              failed ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-700"
            }`}
          >
            {failed ? "Failed" : "Completed"}
          </span>
        </div>

        <p className="text-xs text-zinc-600">
          <span className="font-semibold text-zinc-900">{providerLabel}</span>
          <span className="ml-1.5 text-zinc-400">{detail.model}</span>
        </p>

        {failed ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {detail.errorMessage ?? "This question could not be answered."}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              <MetricBadge label="Mentioned" value={detail.mentioned} />
              <MetricBadge label="Cited" value={detail.cited} />
              {detail.firstMentionIndex !== null && (
                <span className="inline-block rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
                  First mention at character {detail.firstMentionIndex}
                </span>
              )}
            </div>

            <div>
              <h2 className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                Competitors found ({detail.competitors?.length ?? 0})
              </h2>
              {detail.competitors && detail.competitors.length > 0 ? (
                <ol className="mt-1 flex flex-wrap gap-1">
                  {detail.competitors.map((competitor) => (
                    <li
                      key={competitor}
                      className="rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] text-zinc-700"
                    >
                      {competitor}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-1 text-[11px] text-zinc-400">No competitor companies identified in this answer.</p>
              )}
            </div>

            <div>
              <h2 className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                Sources ({detail.sourceCount ?? 0})
              </h2>
              {detail.sources.length === 0 ? (
                <p className="mt-1 text-[11px] text-zinc-400">No citation was returned for this answer.</p>
              ) : (
                <ul className="mt-1 flex flex-col gap-1">
                  {[...new Map(detail.sources.map((source) => [source.url, source])).values()].map((source) => (
                    <li key={source.url} className="truncate text-[11px]">
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-primary-strong hover:underline"
                      >
                        {source.title ?? source.url}
                      </a>
                      {source.domain && <span className="ml-1 text-zinc-400">({source.domain})</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h2 className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                Full {providerLabel} response
              </h2>
              <p className="mt-1 rounded-md border border-zinc-100 bg-zinc-50 p-3 text-xs whitespace-pre-wrap text-zinc-700">
                {detail.answerText}
              </p>
            </div>
          </>
        )}

        {detail.evidence.length > 0 && (
          <details className="text-[11px] text-zinc-500">
            <summary className="cursor-pointer font-semibold tracking-wide uppercase">Technical evidence</summary>
            <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
              {detail.evidence.map((field) => (
                <div key={field.label} className="contents">
                  <dt className="text-zinc-400">{field.label}</dt>
                  <dd className="min-w-0 break-all text-zinc-600">{field.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </div>
    </div>
  );
}
