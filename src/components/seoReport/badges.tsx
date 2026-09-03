import {
  CATEGORY_LABELS,
  ISSUE_TAXONOMY,
  PRIORITY_LABELS,
  type IssueCategory,
  type IssuePriority,
} from "@/lib/reporting/issueTaxonomy";

/**
 * Shared, presentation-only pieces of the SEO report. Extracted out of the
 * site detail page (a Server Component) so the Analysis History modal (a
 * Client Component) can reuse the exact same badges/stat tile instead of
 * duplicating this markup — none of these use hooks or server-only APIs,
 * so this module is safe to import from either side of the server/client
 * boundary.
 */

export function issueLabel(issueType: string): string {
  return (ISSUE_TAXONOMY as Record<string, { label: string }>)[issueType]?.label ?? issueType;
}

export function IssueBadge({
  issueType,
  severity,
  message,
}: {
  issueType: string;
  severity: string;
  message: string;
}) {
  const colors =
    severity === "critical"
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-amber-200 bg-amber-50 text-amber-800";

  return (
    <span
      title={message}
      className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${colors}`}
    >
      {issueLabel(issueType)}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: IssuePriority }) {
  const colors =
    priority === "high"
      ? "border-red-200 bg-red-50 text-red-700"
      : priority === "medium"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-zinc-300 bg-zinc-100 text-zinc-600";

  return (
    <span className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${colors}`}>
      {PRIORITY_LABELS[priority]} priority
    </span>
  );
}

export function CategoryBadge({ category }: { category: IssueCategory }) {
  return (
    <span className="inline-block rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-500">
      {CATEGORY_LABELS[category]}
    </span>
  );
}

export function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xl font-semibold text-zinc-900">{value}</p>
      <p className="text-xs text-zinc-500">{label}</p>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const colors =
    status === "completed"
      ? "border-green-200 bg-green-50 text-green-700"
      : status === "failed"
        ? "border-red-200 bg-red-50 text-red-700"
        : "border-zinc-200 bg-zinc-50 text-zinc-600";

  const label = status === "completed" ? "Completed" : status === "failed" ? "Failed" : "Running";

  return (
    <span className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${colors}`}>
      {label}
    </span>
  );
}
