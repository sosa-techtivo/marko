-- MARKO: AI Visibility Delivery 1A — first vertical slice
-- (ai_visibility_questions, ai_visibility_runs, ai_visibility_results)
--
-- Same tenant-isolation pattern as 0003_seo_crawl.sql: organization_id
-- denormalized onto every row, RLS scoped via organization_memberships,
-- explicit base-table grants (this project has "Automatically expose new
-- tables" disabled). Runs are historical and immutable in the same
-- conceptual sense as crawl_runs — a new run never overwrites an old one.
--
-- Forward-compatibility note (Delivery 2 — Competitive Intelligence, NOT
-- implemented here): ai_visibility_results is keyed by (run_id,
-- question_id) only, with no assumption baked in that a run measures a
-- single subject. Adding a "which brand/subject was this result about"
-- dimension later (e.g. a nullable competitor_id once a competitors table
-- exists) is a plain additive column on this table, the same shape every
-- prior milestone's schema change already took (0004, 0007, 0008, 0012) —
-- it does not require restructuring what's here.

-- AI Visibility questions ------------------------------------------------
-- Belong to a site. `category` is a free-text label, not a managed
-- taxonomy/enum — deliberately the smallest thing that can evolve safely
-- later (see CLAUDE.md's Scope Rule). Deactivating a question (is_active =
-- false) is the "remove" path: it stops the question from being included
-- in future runs while preserving any historical ai_visibility_results
-- rows that reference it — the same archive-don't-delete posture
-- 0006_site_archive.sql established for sites.

create table if not exists public.ai_visibility_questions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  question_text text not null check (btrim(question_text) <> ''),
  category text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_visibility_questions_site_id_idx
  on public.ai_visibility_questions (site_id, created_at);

create index if not exists ai_visibility_questions_organization_id_idx
  on public.ai_visibility_questions (organization_id);

-- AI Visibility runs -------------------------------------------------------
-- One manual run per invocation of "Run AI Visibility analysis" for a site,
-- same historical-run shape as crawl_runs: never overwritten, status closed
-- out exactly once (running -> completed | failed).

create table if not exists public.ai_visibility_runs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  triggered_by uuid not null references auth.users (id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  provider text not null,
  model text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  question_count integer not null default 0,
  succeeded_count integer not null default 0,
  failed_count integer not null default 0,
  error_message text,
  constraint ai_visibility_runs_completed_fields_check check (
    (status = 'running' and completed_at is null)
    or (status in ('completed', 'failed') and completed_at is not null)
  )
);

create index if not exists ai_visibility_runs_site_id_started_at_idx
  on public.ai_visibility_runs (site_id, started_at desc);

create index if not exists ai_visibility_runs_organization_id_idx
  on public.ai_visibility_runs (organization_id);

-- AI Visibility results ----------------------------------------------------
-- One row per (run, question) execution — raw evidence + the deterministic
-- first-pass metrics this slice implements. `status` is per-question
-- ('completed'/'failed' only — a result row is only ever inserted once the
-- provider call has actually finished one way or the other, so there's no
-- 'running' state to express here, unlike ai_visibility_runs). A failed
-- question never blocks or removes any other question's row in the same
-- run.
--
-- Metrics are nullable and NULL-means-"not evaluated", distinct from a
-- genuine negative result (false): a failed question's mentioned/cited/
-- first_mention_index all stay null, never coerced to false/0.

create table if not exists public.ai_visibility_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_visibility_runs (id) on delete cascade,
  question_id uuid not null references public.ai_visibility_questions (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  status text not null check (status in ('completed', 'failed')),
  provider text not null,
  model text not null,
  answer_text text,
  -- Structured citation evidence: a JSON array of
  -- {url, title, domain, startIndex, endIndex}. Defaults to an empty array
  -- (never null) so "no citations returned" is representable without a
  -- separate null-check — a valid, common result, not an error.
  sources jsonb not null default '[]'::jsonb,
  mentioned boolean,
  cited boolean,
  first_mention_index integer,
  usage jsonb,
  raw_response jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  constraint ai_visibility_results_status_fields_check check (
    (status = 'completed' and answer_text is not null)
    or (status = 'failed' and answer_text is null and mentioned is null and cited is null)
  )
);

create index if not exists ai_visibility_results_run_id_idx
  on public.ai_visibility_results (run_id);

create index if not exists ai_visibility_results_question_id_idx
  on public.ai_visibility_results (question_id);

create index if not exists ai_visibility_results_organization_id_idx
  on public.ai_visibility_results (organization_id);

-- Row Level Security ---------------------------------------------------------

alter table public.ai_visibility_questions enable row level security;
alter table public.ai_visibility_runs enable row level security;
alter table public.ai_visibility_results enable row level security;

-- ai_visibility_questions: same shape as sites — members of the owning
-- organization can view/add/edit; insert additionally checks the target
-- site actually belongs to that organization.

create policy "members can view ai visibility questions in their organizations"
  on public.ai_visibility_questions
  for select
  using (
    exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = ai_visibility_questions.organization_id
        and m.user_id = auth.uid()
    )
  );

create policy "members can add ai visibility questions to their organization's sites"
  on public.ai_visibility_questions
  for insert
  with check (
    exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = ai_visibility_questions.organization_id
        and m.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.sites s
      where s.id = ai_visibility_questions.site_id
        and s.organization_id = ai_visibility_questions.organization_id
    )
  );

create policy "members can edit ai visibility questions in their organizations"
  on public.ai_visibility_questions
  for update
  using (
    exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = ai_visibility_questions.organization_id
        and m.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = ai_visibility_questions.organization_id
        and m.user_id = auth.uid()
    )
  );

-- ai_visibility_runs: same shape as crawl_runs.

create policy "members can view ai visibility runs in their organizations"
  on public.ai_visibility_runs
  for select
  using (
    exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = ai_visibility_runs.organization_id
        and m.user_id = auth.uid()
    )
  );

create policy "members can start ai visibility runs for their organization's sites"
  on public.ai_visibility_runs
  for insert
  with check (
    exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = ai_visibility_runs.organization_id
        and m.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.sites s
      where s.id = ai_visibility_runs.site_id
        and s.organization_id = ai_visibility_runs.organization_id
    )
  );

create policy "members can update ai visibility runs in their organizations"
  on public.ai_visibility_runs
  for update
  using (
    exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = ai_visibility_runs.organization_id
        and m.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = ai_visibility_runs.organization_id
        and m.user_id = auth.uid()
    )
  );

-- ai_visibility_results: same shape as crawl_issues, anchored to
-- ai_visibility_runs/ai_visibility_questions instead of crawl_pages.

create policy "members can view ai visibility results in their organizations"
  on public.ai_visibility_results
  for select
  using (
    exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = ai_visibility_results.organization_id
        and m.user_id = auth.uid()
    )
  );

create policy "members can add ai visibility results to their organization's runs"
  on public.ai_visibility_results
  for insert
  with check (
    exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = ai_visibility_results.organization_id
        and m.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.ai_visibility_runs r
      where r.id = ai_visibility_results.run_id
        and r.organization_id = ai_visibility_results.organization_id
    )
    and exists (
      select 1
      from public.ai_visibility_questions q
      where q.id = ai_visibility_results.question_id
        and q.organization_id = ai_visibility_results.organization_id
    )
  );

-- Base table privileges -------------------------------------------------

grant select, insert, update on public.ai_visibility_questions to authenticated;
grant select, insert, update on public.ai_visibility_runs to authenticated;
grant select, insert on public.ai_visibility_results to authenticated;
