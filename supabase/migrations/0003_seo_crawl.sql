-- MARKO: SEO crawl vertical slice (crawl_runs, crawl_pages, crawl_issues)
--
-- One manual crawl run per invocation of "Run SEO analysis" for a site.
-- Historical: previous runs are never overwritten. Follows the same
-- tenant-isolation pattern as 0001_init.sql (organization_id denormalized
-- onto every row, RLS scoped via organization_memberships) and the same
-- explicit-grant pattern as 0002 (this project has "Automatically expose
-- new tables" disabled, so RLS alone is not reachable without base table
-- grants).

-- Crawl runs -----------------------------------------------------------

create table if not exists public.crawl_runs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  triggered_by uuid not null references auth.users (id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  pages_crawled integer not null default 0,
  error_message text,
  constraint crawl_runs_completed_fields_check check (
    (status = 'running' and completed_at is null)
    or (status in ('completed', 'failed') and completed_at is not null)
  )
);

create index if not exists crawl_runs_site_id_started_at_idx
  on public.crawl_runs (site_id, started_at desc);

create index if not exists crawl_runs_organization_id_idx
  on public.crawl_runs (organization_id);

-- Crawl pages ------------------------------------------------------------
-- One row per page fetched during a run. Raw, objective, page-level data.

create table if not exists public.crawl_pages (
  id uuid primary key default gen_random_uuid(),
  crawl_run_id uuid not null references public.crawl_runs (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  url text not null,
  http_status integer,
  title text,
  meta_description text,
  canonical_url text,
  h1 text,
  is_indexable boolean not null default true,
  robots_directives text,
  internal_link_count integer not null default 0,
  fetch_error text,
  created_at timestamptz not null default now()
);

create index if not exists crawl_pages_crawl_run_id_idx
  on public.crawl_pages (crawl_run_id);

create index if not exists crawl_pages_organization_id_idx
  on public.crawl_pages (organization_id);

-- Crawl issues -------------------------------------------------------------
-- Deterministic, rule-based findings derived from a crawl_pages row.
-- Raw Observation -> Finding, per CLAUDE.md's Findings Model. No scoring,
-- no AI: issue_type/severity are fixed, code-driven classifications.

create table if not exists public.crawl_issues (
  id uuid primary key default gen_random_uuid(),
  crawl_run_id uuid not null references public.crawl_runs (id) on delete cascade,
  crawl_page_id uuid not null references public.crawl_pages (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  issue_type text not null check (
    issue_type in (
      'http_error',
      'missing_title',
      'missing_meta_description',
      'missing_h1',
      'non_indexable',
      'invalid_canonical'
    )
  ),
  severity text not null check (severity in ('warning', 'critical')),
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists crawl_issues_crawl_run_id_idx
  on public.crawl_issues (crawl_run_id);

create index if not exists crawl_issues_crawl_page_id_idx
  on public.crawl_issues (crawl_page_id);

create index if not exists crawl_issues_organization_id_idx
  on public.crawl_issues (organization_id);

-- Row Level Security ---------------------------------------------------------

alter table public.crawl_runs enable row level security;
alter table public.crawl_pages enable row level security;
alter table public.crawl_issues enable row level security;

-- crawl_runs: members of the owning organization can read; a member can
-- start a run only for a site that actually belongs to that organization;
-- a member can update a run only to close it out (mark completed/failed).

create policy "members can view crawl runs in their organizations"
  on public.crawl_runs
  for select
  using (
    exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = crawl_runs.organization_id
        and m.user_id = auth.uid()
    )
  );

create policy "members can start crawl runs for their organization's sites"
  on public.crawl_runs
  for insert
  with check (
    exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = crawl_runs.organization_id
        and m.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.sites s
      where s.id = crawl_runs.site_id
        and s.organization_id = crawl_runs.organization_id
    )
  );

create policy "members can update crawl runs in their organizations"
  on public.crawl_runs
  for update
  using (
    exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = crawl_runs.organization_id
        and m.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = crawl_runs.organization_id
        and m.user_id = auth.uid()
    )
  );

-- crawl_pages: members can read/insert pages that belong to a crawl run in
-- their organization.

create policy "members can view crawl pages in their organizations"
  on public.crawl_pages
  for select
  using (
    exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = crawl_pages.organization_id
        and m.user_id = auth.uid()
    )
  );

create policy "members can add crawl pages to their organization's runs"
  on public.crawl_pages
  for insert
  with check (
    exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = crawl_pages.organization_id
        and m.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.crawl_runs r
      where r.id = crawl_pages.crawl_run_id
        and r.organization_id = crawl_pages.organization_id
    )
  );

-- crawl_issues: same shape, anchored to crawl_pages.

create policy "members can view crawl issues in their organizations"
  on public.crawl_issues
  for select
  using (
    exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = crawl_issues.organization_id
        and m.user_id = auth.uid()
    )
  );

create policy "members can add crawl issues to their organization's pages"
  on public.crawl_issues
  for insert
  with check (
    exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = crawl_issues.organization_id
        and m.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.crawl_pages p
      where p.id = crawl_issues.crawl_page_id
        and p.crawl_run_id = crawl_issues.crawl_run_id
        and p.organization_id = crawl_issues.organization_id
    )
  );

-- Base table privileges -------------------------------------------------
-- Required in addition to RLS: this project has "Automatically expose new
-- tables" disabled, so plain SQL-created tables get no default grants.

grant select, insert, update on public.crawl_runs to authenticated;
grant select, insert on public.crawl_pages to authenticated;
grant select, insert on public.crawl_issues to authenticated;
