import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { requireUserAndOrganization } from "@/lib/organizations";
import { resolveSiteBySlug } from "../resolveSite";
import { siteDetailPath } from "@/lib/sites/paths";
import { assembleSiteReportData, type SiteReportRawInput } from "@/lib/reporting/siteReportData";
import { SeoReportDocument } from "@/lib/reporting/pdf/SeoReportDocument";
import { buildReportFilename } from "@/lib/reporting/pdf/filename";
import { getGoogleConnectionStatus } from "@/lib/googleSearchConsole/connectionStatus";
import { getSiteSearchConsoleSnapshot } from "@/lib/googleSearchConsole/siteSnapshot";
import type { SiteSnapshotResult } from "@/lib/googleSearchConsole/siteSnapshot";

// No crawl happens here — just Supabase reads, an optional Search Console
// API call, and in-process PDF rendering — so this is comfortably inside
// a normal function timeout; generous only as headroom, not because any
// single step here is expected to be slow.
export const maxDuration = 30;

/**
 * Downloads the current SEO report as a PDF for one site — GET only (a
 * plain link/navigation triggers a file download natively; no client-side
 * JS or fetch/blob dance required). Tenant-safe by construction: the same
 * `requireUserAndOrganization()` + `resolveSiteBySlug()` pair the site
 * detail page itself uses, so a site outside the caller's organization
 * resolves to nothing here exactly as it does there — no separate,
 * weaker access check for the download path.
 *
 * Every number in the PDF comes from `assembleSiteReportData` — the same
 * domain functions (buildSeoHealthReport/buildSeoChangeReport/
 * buildMarkoInsights, the registered/effective URL helpers) the live site
 * detail page uses, over the same query shapes. See siteReportData.ts.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Redirects to /login itself when unauthenticated — same helper, same
  // behavior, already relied on by the other Route Handler in this app
  // (src/app/dashboard/google/connect/route.ts).
  const { organization } = await requireUserAndOrganization();
  if (!organization) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  const supabase = await createClient();

  const site = await resolveSiteBySlug(supabase, organization.id, slug);
  if (!site) {
    return NextResponse.redirect(new URL("/dashboard?error=site-not-found", request.url));
  }

  try {
    const { data: latestRun } = await supabase
      .from("crawl_runs")
      .select("id, status, started_at, completed_at, error_message")
      .eq("site_id", site.id)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Only the latest and previous completed runs are ever used by the
    // PDF (see siteReportData.ts's module doc comment for why it
    // deliberately doesn't build a multi-run trend from older runs).
    const COMPLETED_RUN_LIMIT = 2;
    const { data: completedRuns } = await supabase
      .from("crawl_runs")
      .select("id, started_at, completed_at")
      .eq("site_id", site.id)
      .eq("status", "completed")
      .order("started_at", { ascending: false })
      .limit(COMPLETED_RUN_LIMIT);

    const latestCompletedRun = completedRuns?.[0] ?? null;
    const previousCompletedRun = completedRuns?.[1] ?? null;

    if (!latestCompletedRun) {
      // No completed analysis to report on — never pretend one exists.
      // The site page's own "No analysis yet" state already explains
      // this; the primary path to get here is disabled entirely in the
      // UI (see RunAnalysisButton's sibling "Download PDF" control), so
      // this is a defensive backstop, not the normal flow.
      return NextResponse.redirect(new URL(siteDetailPath(site.slug), request.url));
    }

    const { data: crawlPages } = await supabase
      .from("crawl_pages")
      .select(
        "id, url, http_status, title, meta_description, h1, canonical_url, is_indexable, final_url, redirect_count",
      )
      .eq("crawl_run_id", latestCompletedRun.id)
      .order("created_at", { ascending: true });

    const { data: crawlIssues } = await supabase
      .from("crawl_issues")
      .select("id, crawl_page_id, issue_type, severity, message")
      .eq("crawl_run_id", latestCompletedRun.id);

    const { data: comparisonPages } = previousCompletedRun
      ? await supabase
          .from("crawl_pages")
          .select("id, crawl_run_id, url, http_status, fetch_error, final_url, redirect_count, canonical_url")
          .in("crawl_run_id", [latestCompletedRun.id, previousCompletedRun.id])
      : { data: null };

    const { data: comparisonIssues } = previousCompletedRun
      ? await supabase
          .from("crawl_issues")
          .select("crawl_run_id, crawl_page_id, issue_type")
          .in("crawl_run_id", [latestCompletedRun.id, previousCompletedRun.id])
      : { data: null };

    // Search Console must never block PDF generation — every call in this
    // pipeline already returns a typed error variant rather than
    // throwing (see connectionStatus.ts/siteSnapshot.ts), but this is
    // wrapped defensively anyway so a genuinely unexpected exception here
    // still degrades to "no Search Console section" instead of failing
    // the whole download.
    let searchConsoleSnapshot: SiteSnapshotResult | null = null;
    try {
      const gscConnection = await getGoogleConnectionStatus(supabase, organization.id);
      if (gscConnection.connected && !gscConnection.needsReauth && site.search_console_property_url) {
        searchConsoleSnapshot = await getSiteSearchConsoleSnapshot(
          organization.id,
          site.search_console_property_url,
        );
      }
    } catch (err) {
      console.error("[report] Search Console lookup failed; omitting from PDF", {
        message: err instanceof Error ? err.message : String(err),
      });
      searchConsoleSnapshot = null;
    }

    const rawInput: SiteReportRawInput = {
      site: {
        name: site.name,
        slug: site.slug,
        url: site.url,
        effective_url: site.effective_url,
      },
      latestRun: latestRun ?? null,
      completedRuns: completedRuns ?? [],
      latestCrawlPages: crawlPages ?? [],
      latestCrawlIssues: crawlIssues ?? [],
      comparisonPages: comparisonPages ?? [],
      comparisonIssues: comparisonIssues ?? [],
      searchConsoleSnapshot,
    };

    const data = assembleSiteReportData(rawInput);
    const buffer = await renderToBuffer(SeoReportDocument({ data }));
    const filename = buildReportFilename(site.name, new Date(data.generatedAt));

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.length),
        // Contains the client's own SEO/Search Console data — never a
        // shared/public cache.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[report] PDF generation failed", {
      siteId: site.id,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.redirect(
      new URL(`${siteDetailPath(site.slug)}?error=report-generation-failed`, request.url),
    );
  }
}
