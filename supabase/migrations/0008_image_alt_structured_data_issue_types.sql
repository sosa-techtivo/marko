-- MARKO: add `images_missing_alt` and `invalid_structured_data` checks
--
-- Widens crawl_issues.issue_type's check constraint to allow these two new
-- issue types. No new tables/columns — same pattern as 0004 and 0007:
-- both are derived entirely from data extracted from the already-fetched
-- page HTML (image alt attributes, JSON-LD script blocks), one finding per
-- page rather than one per image/script block. See
-- src/lib/crawler/analyze.ts, src/lib/crawler/html.ts, and
-- src/lib/reporting/issueTaxonomy.ts.

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
      'invalid_structured_data'
    )
  );
