-- MARKO: robots.txt blocking detection + redirect transparency
--
-- Two REQUIRED SEO audit MVP gaps (see PROJECT_STATUS.md):
--  1. robots.txt blocking detection — a new `blocked_by_robots_txt` issue,
--     plus per-crawl-run evidence of the robots.txt fetch itself so a
--     failed/inconclusive fetch is distinguishable from "no rules found".
--  2. redirect transparency — a new `redirected` issue, plus the final URL
--     and hop count each analyzed page actually resolved to.
--
-- All new columns are additive and nullable (or have a safe default), so
-- existing historical crawl_runs/crawl_pages rows remain valid without a
-- backfill. See src/lib/crawler/robotsTxt.ts, src/lib/crawler/fetchPage.ts,
-- src/lib/crawler/analyze.ts, and src/lib/reporting/issueTaxonomy.ts.

alter table public.crawl_runs
  add column if not exists robots_txt_status integer,
  add column if not exists robots_txt_fetch_error text;

alter table public.crawl_pages
  add column if not exists final_url text,
  add column if not exists redirect_count integer not null default 0;

alter table public.crawl_issues
  drop constraint if exists crawl_issues_issue_type_check;

alter table public.crawl_issues
  add constraint crawl_issues_issue_type_check
  check (
    issue_type in (
      'http_error',
      'missing_title',
      'title_too_short',
      'title_too_long',
      'duplicate_title',
      'missing_meta_description',
      'meta_description_too_short',
      'meta_description_too_long',
      'duplicate_meta_description',
      'missing_h1',
      'multiple_h1',
      'non_indexable',
      'invalid_canonical',
      'missing_canonical',
      'duplicate_canonical',
      'canonical_chain',
      'images_missing_alt',
      'invalid_structured_data',
      'redirected',
      'blocked_by_robots_txt'
    )
  );
