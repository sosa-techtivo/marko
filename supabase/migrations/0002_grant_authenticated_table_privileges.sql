-- MARKO: grant base table privileges to `authenticated`
--
-- This project has "Automatically expose new tables" disabled, so creating a
-- table via a plain SQL migration (as 0001_init.sql did) does not grant the
-- `authenticated`/`anon` roles any privileges on it — only Supabase Studio's
-- table-editor GUI does that automatically. RLS policies alone are not
-- enough: PostgREST/Postgres checks base table-level GRANTs before RLS is
-- ever evaluated, so `authenticated` was hitting
-- `42501 permission denied for table organization_memberships` on every
-- request, regardless of the RLS policies already in place.
--
-- These GRANTs restore exactly the access each flow needs; RLS (already
-- defined in 0001_init.sql) continues to scope every row to the caller's
-- own organization memberships.

-- Dashboard / current-organization resolution need to read organizations
-- and memberships (scoped by RLS to the caller's own memberships).
grant select on public.organizations to authenticated;
grant select on public.organization_memberships to authenticated;

-- Sites list (dashboard) and the "add site" form both go directly through
-- PostgREST, scoped by RLS to the caller's organization.
grant select, insert on public.sites to authenticated;

-- Deliberately not granted:
-- - insert/update/delete on organizations, organization_memberships: an
--   organization and its first membership are created exclusively via the
--   security definer public.create_organization() function (see
--   0001_init.sql), which runs with the function owner's privileges and so
--   does not need `authenticated` to hold direct table privileges.
-- - update/delete on sites: no edit/delete flow exists yet.
