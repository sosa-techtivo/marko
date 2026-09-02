-- MARKO: dashboard site-card favicons
--
-- Adds a nullable favicon_url column to sites, populated from the crawler's
-- already-fetched start-page HTML (src/lib/crawler/favicon.ts) — no new
-- network fetch server-side, no third-party favicon service. Persisted so
-- /dashboard can render it without re-crawling the site.
--
-- Deliberately NOT a general UPDATE policy/grant on sites: site
-- editing is explicitly out of MVP scope, and a blanket UPDATE policy
-- would allow any org member to rewrite a site's name/url via a direct
-- table call, not just its favicon. Instead, following the same pattern
-- as create_organization(), a narrow security-definer RPC updates only
-- this one column, scoped to the caller's own organization membership.

alter table public.sites add column if not exists favicon_url text;

create or replace function public.update_site_favicon(site_id uuid, favicon_url text)
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
  set favicon_url = update_site_favicon.favicon_url
  where s.id = update_site_favicon.site_id
    and exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = s.organization_id
        and m.user_id = auth.uid()
    );
end;
$$;

revoke all on function public.update_site_favicon(uuid, text) from public;
grant execute on function public.update_site_favicon(uuid, text) to authenticated;
