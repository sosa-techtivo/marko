-- MARKO: human-readable Site slugs for public detail URLs
--
-- Replaces UUID-based /dashboard/sites/<uuid> URLs with
-- /dashboard/sites/<slug>. The UUID (`sites.id`) remains the sole internal
-- identity/FK reference everywhere else (crawl_runs, crawl_pages,
-- crawl_issues, Search Console property association, Analysis History,
-- etc.) — nothing about those relationships changes; `slug` is purely an
-- additional, publicly-addressable alias used for routing.
--
-- Slug generation/collision handling for *new* sites lives in application
-- code (src/lib/sites/slug.ts, used by createSite in
-- src/app/dashboard/sites/actions.ts) rather than a database function —
-- consistent with this project's existing preference for pure,
-- unit-tested TypeScript business logic (see e.g.
-- src/lib/reporting/markoInsights.ts, src/lib/reporting/seoChangeReport.ts)
-- over PL/pgSQL. This migration only needs its own, one-time version of
-- that same slug/collision algorithm to backfill existing rows; the two
-- are intentionally independent going forward — this migration is a
-- frozen, one-time historical script, not living code the application
-- depends on, so it doesn't need to track any future change to the
-- application-side slug rules.
--
-- Slugs are unique per organization, not globally (two different
-- organizations can each have a site slugged "techtivo") — matching this
-- project's existing per-organization tenant-scoping convention (see
-- sites_organization_id_idx etc. in 0001_init.sql).

-- One-time backfill helpers -------------------------------------------------
-- Not granted to `authenticated` and not referenced by anything outside
-- the backfill DO block immediately below.

-- Lowercase, non-alphanumeric runs collapsed to a single '-',
-- leading/trailing '-' trimmed, capped at 60 characters (with any trailing
-- '-' left by truncation trimmed again), falling back to 'site' if the
-- name has no alphanumeric characters at all — same rules as
-- src/lib/sites/slug.ts's `slugify`.
create or replace function public.slugify(input text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(
      trim(both '-' from substring(
        regexp_replace(lower(btrim(coalesce(input, ''))), '[^a-z0-9]+', '-', 'g')
        from 1 for 60
      )),
      ''
    ),
    'site'
  );
$$;

-- Deterministic collision handling within one organization: 'techtivo',
-- then 'techtivo-2', 'techtivo-3', etc. — the first free suffix in
-- ascending order, checked one candidate at a time so results are stable
-- and reproducible. `p_exclude_site_id` lets a site be excluded from its
-- own collision check (unused today — no slug-editing flow exists — but
-- avoids this function needing to change if one is ever added).
create or replace function public.generate_unique_site_slug(
  p_organization_id uuid,
  p_name text,
  p_exclude_site_id uuid default null
)
returns text
language plpgsql
as $$
declare
  base_slug text := public.slugify(p_name);
  candidate text := base_slug;
  suffix integer := 2;
begin
  while exists (
    select 1
    from public.sites s
    where s.organization_id = p_organization_id
      and s.slug = candidate
      and (p_exclude_site_id is null or s.id <> p_exclude_site_id)
  ) loop
    candidate := base_slug || '-' || suffix;
    suffix := suffix + 1;
  end loop;

  return candidate;
end;
$$;

-- Column + backfill ---------------------------------------------------------

alter table public.sites add column if not exists slug text;

-- Backfill existing rows one at a time, in a stable order (oldest first,
-- per organization), so that if two sites in the same org share a name the
-- second one deterministically gets '-2' rather than both racing for the
-- same base slug. A single set-based UPDATE can't guarantee this — each
-- row's collision check needs to see the slugs *just* assigned to earlier
-- rows in this same backfill, which only a row-by-row loop guarantees
-- (Postgres takes a fresh snapshot per statement within a transaction, so
-- each iteration's lookup inside generate_unique_site_slug does see the
-- previous iterations' UPDATEs).
do $$
declare
  site_row record;
begin
  for site_row in
    select id, organization_id, name
    from public.sites
    where slug is null
    order by organization_id, created_at, id
  loop
    update public.sites
    set slug = public.generate_unique_site_slug(site_row.organization_id, site_row.name, site_row.id)
    where id = site_row.id;
  end loop;
end;
$$;

alter table public.sites alter column slug set not null;

-- Uniqueness is per-organization, not global — matches how every other
-- tenant-scoped uniqueness concern in this schema works. This constraint's
-- implicit unique btree index also serves the route's
-- (organization_id, slug) lookup (see resolveSiteBySlug in
-- src/app/dashboard/sites/[slug]/resolveSite.ts) — no separate index needed.
alter table public.sites
  add constraint sites_organization_id_slug_key unique (organization_id, slug);

revoke all on function public.slugify(text) from public;
revoke all on function public.generate_unique_site_slug(uuid, text, uuid) from public;
