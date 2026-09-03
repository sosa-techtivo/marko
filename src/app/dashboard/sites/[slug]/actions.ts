"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUserAndOrganization } from "@/lib/organizations";
import { runCrawl } from "@/lib/crawler/runCrawl";
import {
  buildSeoHealthReport,
  type CrawlPageRow,
  type SeoOpportunity,
} from "@/lib/reporting/seoHealthReport";
import type { PageIssueRow } from "@/components/seoReport/AnalyzedPagesTable";
import { siteDetailPath } from "@/lib/sites/paths";

export async function runSeoAnalysis(formData: FormData) {
  const siteId = String(formData.get("siteId") ?? "").trim();
  if (!siteId) {
    redirect("/dashboard");
  }

  const { user, organization } = await requireUserAndOrganization();
  if (!organization) {
    redirect("/dashboard");
  }

  const supabase = await createClient();

  const { data: site, error: siteError } = await supabase
    .from("sites")
    .select("id, organization_id, url, slug")
    .eq("id", siteId)
    .eq("organization_id", organization.id)
    .maybeSingle();

  if (siteError) {
    console.error("[runSeoAnalysis] site lookup failed", {
      code: siteError.code,
      message: siteError.message,
    });
  }

  if (!site) {
    redirect("/dashboard?error=site-not-found");
  }

  const { data: crawlRun, error: insertRunError } = await supabase
    .from("crawl_runs")
    .insert({
      site_id: site.id,
      organization_id: organization.id,
      triggered_by: user.id,
      status: "running",
    })
    .select("id")
    .single();

  if (insertRunError || !crawlRun) {
    console.error("[runSeoAnalysis] failed to create crawl run", {
      code: insertRunError?.code,
      message: insertRunError?.message,
      details: insertRunError?.details,
      hint: insertRunError?.hint,
    });
    redirect(`${siteDetailPath(site.slug)}?error=crawl-start-failed`);
  }

  const result = await runCrawl(site.url);

  if (result.ok) {
    const { error: faviconError } = await supabase.rpc("update_site_favicon", {
      site_id: site.id,
      favicon_url: result.faviconUrl,
    });
    if (faviconError) {
      // Non-fatal: the dashboard just falls back to the initial-letter
      // avatar for this site until a later crawl succeeds in updating it.
      console.error("[runSeoAnalysis] update_site_favicon RPC failed", {
        code: faviconError.code,
        message: faviconError.message,
      });
    }
  }

  if (!result.ok) {
    const { error: closeError } = await supabase
      .from("crawl_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        pages_crawled: 0,
        error_message: result.error,
      })
      .eq("id", crawlRun.id);

    if (closeError) {
      console.error("[runSeoAnalysis] failed to record crawl failure", {
        code: closeError.code,
        message: closeError.message,
      });
    }

    redirect(siteDetailPath(site.slug));
  }

  const { data: insertedPages, error: pagesError } = await supabase
    .from("crawl_pages")
    .insert(
      result.pages.map((page) => ({
        crawl_run_id: crawlRun.id,
        organization_id: organization.id,
        url: page.url,
        http_status: page.httpStatus,
        title: page.title,
        meta_description: page.metaDescription,
        canonical_url: page.canonicalUrl,
        h1: page.h1,
        is_indexable: page.isIndexable,
        robots_directives: page.robotsDirectives,
        internal_link_count: page.internalLinkCount,
        fetch_error: page.fetchError,
      })),
    )
    .select("id, url");

  if (pagesError || !insertedPages) {
    console.error("[runSeoAnalysis] failed to persist crawl pages", {
      code: pagesError?.code,
      message: pagesError?.message,
      details: pagesError?.details,
      hint: pagesError?.hint,
    });

    await supabase
      .from("crawl_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        pages_crawled: 0,
        error_message: "The crawl completed but its results could not be saved.",
      })
      .eq("id", crawlRun.id);

    redirect(siteDetailPath(site.slug));
  }

  const pageIdByUrl = new Map(insertedPages.map((row) => [row.url, row.id]));

  const issuesToInsert = result.pages.flatMap((page) => {
    const crawlPageId = pageIdByUrl.get(page.url);
    if (!crawlPageId) return [];
    return page.issues.map((issue) => ({
      crawl_run_id: crawlRun.id,
      crawl_page_id: crawlPageId,
      organization_id: organization.id,
      issue_type: issue.type,
      severity: issue.severity,
      message: issue.message,
    }));
  });

  if (issuesToInsert.length > 0) {
    const { error: issuesError } = await supabase.from("crawl_issues").insert(issuesToInsert);
    if (issuesError) {
      console.error("[runSeoAnalysis] failed to persist crawl issues", {
        code: issuesError.code,
        message: issuesError.message,
        details: issuesError.details,
        hint: issuesError.hint,
      });
    }
  }

  const { error: completeError } = await supabase
    .from("crawl_runs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      pages_crawled: result.pages.length,
    })
    .eq("id", crawlRun.id);

  if (completeError) {
    console.error("[runSeoAnalysis] failed to mark crawl run completed", {
      code: completeError.code,
      message: completeError.message,
    });
  }

  redirect(siteDetailPath(site.slug));
}

export type CrawlRunDetailResult =
  | {
      ok: true;
      run: {
        id: string;
        status: string;
        startedAt: string;
        completedAt: string | null;
        errorMessage: string | null;
      };
      summary: {
        pagesAnalyzed: number;
        pagesWithIssues: number;
        highPriorityIssues: number;
        totalIssues: number;
      };
      opportunities: SeoOpportunity[];
      pages: CrawlPageRow[];
      issues: PageIssueRow[];
    }
  | { ok: false; error: string };

/**
 * Loads the persisted report for one specific historical crawl_run, for
 * the Analysis History modal. Reuses buildSeoHealthReport — the exact same
 * derivation the live report uses — over that run's own crawl_pages/
 * crawl_issues rows only; never reads or is influenced by the site's
 * current latest run.
 *
 * Tenant isolation: the crawl_runs lookup is explicitly scoped to both
 * `siteId` and the caller's own `organization.id`, on top of RLS (which
 * independently enforces the same organization boundary — see
 * 0003_seo_crawl.sql). A run outside either scope, or that doesn't exist,
 * returns the same generic "not found" error, so this can't be used to
 * probe for another tenant's data.
 */
export async function getCrawlRunDetail(
  siteId: string,
  crawlRunId: string,
): Promise<CrawlRunDetailResult> {
  const { organization } = await requireUserAndOrganization();
  if (!organization) {
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  const supabase = await createClient();

  const { data: run } = await supabase
    .from("crawl_runs")
    .select("id, status, started_at, completed_at, error_message")
    .eq("id", crawlRunId)
    .eq("site_id", siteId)
    .eq("organization_id", organization.id)
    .maybeSingle();

  if (!run) {
    return { ok: false, error: "That analysis could not be found." };
  }

  const { data: pages } = await supabase
    .from("crawl_pages")
    .select("id, url, http_status, title, meta_description, h1, canonical_url, is_indexable")
    .eq("crawl_run_id", run.id)
    .order("created_at", { ascending: true });

  const { data: issues } = await supabase
    .from("crawl_issues")
    .select("id, crawl_page_id, issue_type, severity, message")
    .eq("crawl_run_id", run.id);

  const healthReport = buildSeoHealthReport(pages ?? [], issues ?? []);

  return {
    ok: true,
    run: {
      id: run.id,
      status: run.status,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      errorMessage: run.error_message,
    },
    summary: healthReport.summary,
    opportunities: healthReport.opportunities,
    pages: pages ?? [],
    issues: issues ?? [],
  };
}
