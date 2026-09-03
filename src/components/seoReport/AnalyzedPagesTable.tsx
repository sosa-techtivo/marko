import type { CrawlPageRow } from "@/lib/reporting/seoHealthReport";
import { IssueBadge } from "./badges";

export type PageIssueRow = {
  id: string;
  crawl_page_id: string;
  issue_type: string;
  severity: string;
  message: string;
};

/**
 * Same URL / Status / Title / Issues table as the live report's "Analyzed
 * pages" section — groups issues by page internally so callers just pass
 * the flat rows for one crawl_run. Shared by the live Site Report and the
 * Analysis History modal so neither duplicates this rendering.
 */
export function AnalyzedPagesTable({
  pages,
  issues,
}: {
  pages: CrawlPageRow[];
  issues: PageIssueRow[];
}) {
  const issuesByPageId = new Map<string, PageIssueRow[]>();
  for (const issue of issues) {
    const list = issuesByPageId.get(issue.crawl_page_id) ?? [];
    list.push(issue);
    issuesByPageId.set(issue.crawl_page_id, list);
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-xs text-zinc-500">
            <th className="px-4 py-2 font-medium">URL</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Title</th>
            <th className="px-4 py-2 font-medium">Issues</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200">
          {pages.map((page) => (
            <tr key={page.id}>
              <td className="max-w-xs truncate px-4 py-3 text-zinc-900">{page.url}</td>
              <td className="px-4 py-3 text-zinc-600">{page.http_status ?? "—"}</td>
              <td className="max-w-xs truncate px-4 py-3 text-zinc-600">{page.title ?? "—"}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {(issuesByPageId.get(page.id) ?? []).map((issue) => (
                    <IssueBadge
                      key={issue.id}
                      issueType={issue.issue_type}
                      severity={issue.severity}
                      message={issue.message}
                    />
                  ))}
                  {(issuesByPageId.get(page.id) ?? []).length === 0 && (
                    <span className="text-xs text-zinc-400">None</span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
