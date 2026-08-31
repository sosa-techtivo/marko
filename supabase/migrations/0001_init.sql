-- MARKO: multi-tenant account foundation (organizations, memberships, sites)

create extension if not exists "pgcrypto";

-- Organizations ---------------------------------------------------------
-- Represent a client/business account. Not auto-created on signup — a
-- signed-in user explicitly creates one via public.create_organization().

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Organization memberships (many-to-many: a user may belong to multiple orgs)
-- No role/permission column: membership existence is all that's required for
-- tenant isolation.

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index if not exists organization_memberships_user_id_idx
  on public.organization_memberships (user_id);

create index if not exists organization_memberships_organization_id_idx
  on public.organization_memberships (organization_id);

-- Sites -----------------------------------------------------------------

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  url text not null,
  created_at timestamptz not null default now()
);

create index if not exists sites_organization_id_idx
  on public.sites (organization_id);

-- Row Level Security ---------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.sites enable row level security;

-- A user can see only their own membership rows.
create policy "members can view their own memberships"
  on public.organization_memberships
  for select
  using (user_id = auth.uid());

-- A user can see only organizations they belong to.
create policy "members can view their organizations"
  on public.organizations
  for select
  using (
    exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = organizations.id
        and m.user_id = auth.uid()
    )
  );

-- A user can see/add sites only within organizations they belong to.
create policy "members can view sites in their organizations"
  on public.sites
  for select
  using (
    exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = sites.organization_id
        and m.user_id = auth.uid()
    )
  );

create policy "members can add sites to their organizations"
  on public.sites
  for insert
  with check (
    exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = sites.organization_id
        and m.user_id = auth.uid()
    )
  );

-- No insert policies exist on organizations / organization_memberships:
-- creating an organization always goes through create_organization() below,
-- so a user can never self-attach a membership row to an organization they
-- didn't just create.

-- Organization creation ------------------------------------------------------
-- The only way to create an organization + its first membership. Runs as
-- security definer so it can atomically insert both rows: a plain client-side
-- insert into `organizations` would have its RETURNING filtered out by the
-- select policy above, since no membership exists yet at insert time.

create or replace function public.create_organization(org_name text)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org public.organizations;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if org_name is null or btrim(org_name) = '' then
    raise exception 'organization name is required';
  end if;

  insert into public.organizations (name)
  values (btrim(org_name))
  returning * into new_org;

  insert into public.organization_memberships (organization_id, user_id)
  values (new_org.id, auth.uid());

  return new_org;
end;
$$;

revoke all on function public.create_organization(text) from public;
grant execute on function public.create_organization(text) to authenticated;
