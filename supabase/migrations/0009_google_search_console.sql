-- MARKO: Google Search Console integration foundation
--
-- Two concerns, deliberately kept separate:
--
-- 1. `google_connections` — one Google OAuth connection per organization
--    (the connection belongs to the org, not to an individual site or
--    user). Holds the only credentials this project stores outside of
--    Supabase Auth itself: a refresh token and a short-lived access token.
--
--    This table intentionally gets NO grants to `authenticated`/`anon` and
--    NO row-level-security policies for them. This project has
--    "Automatically expose new tables" disabled (see
--    0002_grant_authenticated_table_privileges.sql), so simply never
--    granting select/insert/update here means PostgREST — and therefore
--    every browser-side and RLS-scoped server-side Supabase call — cannot
--    reach this table at all, under any policy. The only way in is
--    Postgres's `service_role`, which Supabase grants full access to
--    independently of our migrations, and which this project only ever
--    uses from trusted server-only code
--    (src/lib/supabase/serviceRole.ts, imported exclusively by
--    src/lib/googleSearchConsole/connectionStore.ts). RLS is still enabled
--    below for defense in depth and to document intent, even though no
--    policy ever grants a normal request access.
--
--    A normal (RLS-scoped) request can still learn *whether* a connection
--    exists and is healthy — never the tokens themselves — via the
--    security-definer get_google_connection_status() function.
--
-- 2. The Search Console *property* a given site is associated with is not
--    a secret, so it's stored directly on `sites` (two nullable columns)
--    and follows the exact same narrow-RPC pattern 0006_site_archive.sql
--    already established for mutating a `sites` row without a general
--    UPDATE grant/policy.

create table if not exists public.google_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade unique,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  -- The exact OAuth scope(s) actually granted, as returned by Google —
  -- kept for auditability, not currently branched on in application code.
  scope text not null,
  -- Set when a refresh attempt fails with an error indicating the refresh
  -- token itself is no longer usable (revoked, expired, or the grant was
  -- otherwise invalidated on Google's side) — see
  -- src/lib/googleSearchConsole/tokens.ts. Surfaced to the user as
  -- "Reconnect required" rather than failing silently.
  needs_reauth boolean not null default false,
  connected_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.google_connections enable row level security;
-- Deliberately no policies: see the comment above this table. No grants to
-- authenticated/anon either — access is exclusively via service_role.

-- Search Console property association -----------------------------------

alter table public.sites add column if not exists search_console_property_url text;
alter table public.sites add column if not exists search_console_property_type text
  check (search_console_property_type in ('url_prefix', 'domain'));

-- Both columns are set together or not at all — a property type with no
-- URL (or vice versa) is never a valid state.
alter table public.sites add constraint sites_search_console_property_pair_check
  check (
    (search_console_property_url is null) = (search_console_property_type is null)
  );

-- Non-sensitive connection status for the UI -----------------------------
-- Returns only whether a connection exists and its health — never the
-- tokens. Callable by any authenticated member of the organization, same
-- membership check every other RPC in this project uses.

create or replace function public.get_google_connection_status(p_organization_id uuid)
returns table (connected boolean, needs_reauth boolean, connected_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.google_connections;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
  ) then
    raise exception 'not a member of this organization';
  end if;

  -- `organization_id` is UNIQUE on google_connections, so this matches at
  -- most one row. SELECT ... INTO (unlike RETURN QUERY) unambiguously sets
  -- FOUND based on whether a row was actually assigned.
  select * into existing
  from public.google_connections gc
  where gc.organization_id = p_organization_id;

  if found then
    return query select true, existing.needs_reauth, existing.created_at;
  else
    -- No matching row: return a single "not connected" row instead of an
    -- empty result set, so callers don't need to special-case "no rows".
    return query select false, false, null::timestamptz;
  end if;
end;
$$;

-- Property association RPCs ----------------------------------------------

create or replace function public.set_site_search_console_property(
  site_id uuid,
  property_url text,
  property_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if property_url is null or btrim(property_url) = '' then
    raise exception 'property_url is required';
  end if;

  if property_type not in ('url_prefix', 'domain') then
    raise exception 'invalid property_type';
  end if;

  update public.sites s
  set search_console_property_url = btrim(property_url),
      search_console_property_type = property_type
  where s.id = set_site_search_console_property.site_id
    and exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = s.organization_id
        and m.user_id = auth.uid()
    );

  if not found then
    raise exception 'site not found or not in your organization';
  end if;
end;
$$;

create or replace function public.clear_site_search_console_property(site_id uuid)
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
  set search_console_property_url = null,
      search_console_property_type = null
  where s.id = clear_site_search_console_property.site_id
    and exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = s.organization_id
        and m.user_id = auth.uid()
    );

  if not found then
    raise exception 'site not found or not in your organization';
  end if;
end;
$$;

revoke all on function public.get_google_connection_status(uuid) from public;
revoke all on function public.set_site_search_console_property(uuid, text, text) from public;
revoke all on function public.clear_site_search_console_property(uuid) from public;
grant execute on function public.get_google_connection_status(uuid) to authenticated;
grant execute on function public.set_site_search_console_property(uuid, text, text) to authenticated;
grant execute on function public.clear_site_search_console_property(uuid) to authenticated;
