-- MARKO: registered vs. effective site URL
--
-- Adds sites.effective_url (nullable, additive) — the real destination a
-- site's seed page actually resolved to on its most recent successful
-- crawl, derived from the already-persisted redirect-transparency data
-- (crawl_pages.final_url, see 0012_robots_txt_and_redirect_transparency.sql).
--
-- sites.url remains the Registered URL: exactly what the user entered, and
-- where every crawl still starts from — unchanged, never overwritten.
--
-- No backfill: existing sites simply get effective_url = null until their
-- next successful analysis, at which point runSeoAnalysis populates it
-- (src/app/dashboard/sites/[slug]/actions.ts). Every read path falls back
-- to sites.url when effective_url is null, so this is safe to ship without
-- touching any existing row.

alter table public.sites
  add column if not exists effective_url text;
