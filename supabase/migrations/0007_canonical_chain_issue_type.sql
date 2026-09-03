-- MARKO: add the `canonical_chain` deterministic SEO check
--
-- Widens crawl_issues.issue_type's check constraint to allow this one new
-- issue type. No new tables/columns — like 0004_seo_rules_expansion.sql,
-- this is derived entirely from crawl_pages data the crawler already
-- persists (each page's already-resolved canonicalUrl). See
-- src/lib/crawler/crossPageChecks.ts and src/lib/reporting/issueTaxonomy.ts.

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
      'canonical_chain'
    )
  );
