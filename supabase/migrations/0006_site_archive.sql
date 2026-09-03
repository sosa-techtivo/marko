-- MARKO: site lifecycle — archive / restore / permanently delete
--
-- Adds sites.archived_at (nullable timestamptz, not a boolean) so a site
-- can be hidden from the active dashboard list without deleting it.
-- Archiving never touches crawl_runs/crawl_pages/crawl_issues — those stay
-- exactly as they are, preserving full history for an archived site.
--
-- Follows the same pattern as 0005_add_site_favicon.sql: no general
-- UPDATE/DELETE grant on `sites` (that would let any org member rewrite
-- name/url or delete any site directly) — three narrow security-definer
-- RPCs instead, each scoped to the caller's own organization membership,
-- matching create_organization()'s pattern. Each RPC also enforces the
-- correct lifecycle transition server-side (not just in the UI):
-- archive only from active, restore only from archived, permanent delete
-- only from archived.

alter table public.sites add column if not exists archived_at timestamptz;

-- Used by the dashboard's active/archived filtering (organization_id is
-- already indexed alone via sites_organization_id_idx from 0001_init.sql;
-- this composite index serves the "active sites in my org" / "archived
-- sites in my org" queries specifically).
create index if not exists sites_organization_id_archived_at_idx
  on public.sites (organization_id, archived_at);

-- Archive: active -> archived. No-op (0 rows affected) if the site is
-- already archived, not found, or not in the caller's organization.
create or replace function public.archive_site(site_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  update public.sites s
  set archived_at = now()
  where s.id = archive_site.site_id
    and s.archived_at is null
    and exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = s.organization_id
        and m.user_id = auth.uid()
    );
end;
$$;

-- Restore: archived -> active. No-op if the site isn't currently archived,
-- not found, or not in the caller's organization.
create or replace function public.restore_site(site_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  update public.sites s
  set archived_at = null
  where s.id = restore_site.site_id
    and s.archived_at is not null
    and exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = s.organization_id
        and m.user_id = auth.uid()
    );
end;
$$;

-- Permanently delete: only ever allowed for an already-archived site —
-- enforced here, not just by the UI only offering this action on archived
-- cards. crawl_runs, crawl_pages, and crawl_issues all reference sites
-- (transitively) with `on delete cascade` (see 0003_seo_crawl.sql), so
-- this single delete removes every related crawl run, page, and issue
-- automatically — no separate cleanup statements needed here.
create or replace function public.delete_site_permanently(site_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  delete from public.sites s
  where s.id = delete_site_permanently.site_id
    and s.archived_at is not null
    and exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = s.organization_id
        and m.user_id = auth.uid()
    );

  get diagnostics deleted_count = row_count;
  if deleted_count = 0 then
    raise exception 'site not found, not in your organization, or not archived';
  end if;
end;
$$;

revoke all on function public.archive_site(uuid) from public;
revoke all on function public.restore_site(uuid) from public;
revoke all on function public.delete_site_permanently(uuid) from public;
grant execute on function public.archive_site(uuid) to authenticated;
grant execute on function public.restore_site(uuid) to authenticated;
grant execute on function public.delete_site_permanently(uuid) to authenticated;
