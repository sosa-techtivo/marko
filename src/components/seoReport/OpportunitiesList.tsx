import type { SeoOpportunity } from "@/lib/reporting/seoHealthReport";
import { PriorityBadge, CategoryBadge } from "./badges";

/**
 * Renders already-computed SeoOpportunity cards — same grouping/sorting as
 * buildSeoHealthReport, same compact presentation as the live report's Top
 * Opportunities section (affected-page lists past 3 entries collapse
 * behind a native <details> toggle). Shared by the live Site Report and
 * the Analysis History modal so neither duplicates this rendering.
 */
export function OpportunitiesList({ opportunities }: { opportunities: SeoOpportunity[] }) {
  return (
    <div className="flex flex-col gap-2">
      {opportunities.map((opportunity) => {
        const affectedPages = opportunity.affectedPages;
        const pageList = (
          <ul className="flex flex-col gap-1">
            {affectedPages.map((page) => (
              <li key={page.url} className="text-xs text-zinc-500">
                <span className="text-zinc-700">{page.url}</span> — {page.message}
              </li>
            ))}
          </ul>
        );

        return (
          <div
            key={opportunity.issueType}
            className="rounded-lg border border-zinc-200 bg-white p-3"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <PriorityBadge priority={opportunity.priority} />
              <CategoryBadge category={opportunity.category} />
              <h3 className="text-xs font-medium text-zinc-900">{opportunity.label}</h3>
              <span className="text-xs text-zinc-500">
                {affectedPages.length} page{affectedPages.length === 1 ? "" : "s"} affected
              </span>
            </div>
            <p className="mt-1.5 text-xs text-zinc-600">{opportunity.whyItMatters}</p>
            <p className="mt-1 text-xs text-zinc-800">
              <span className="font-medium">Review: </span>
              {opportunity.recommendedAction}
            </p>
            {affectedPages.length > 3 ? (
              <details className="mt-2 border-t border-zinc-100 pt-2">
                <summary className="cursor-pointer text-xs font-medium text-primary-strong">
                  {affectedPages.length} affected pages
                </summary>
                <div className="mt-2">{pageList}</div>
              </details>
            ) : (
              <div className="mt-2 border-t border-zinc-100 pt-2">{pageList}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
