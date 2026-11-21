-- Foundation: tenancy tables, the current-user helpers and the triggers every
-- synced table shares.
--
-- Access model: clients may only read tables (through RLS). Every write goes
-- through public.push (see the sync_api migration), the single server-side
-- unit that applies operations. Provisioning uses the service role.

-- Helpers and server-only tables live here. The schema is not exposed through
-- the Data API.
create schema private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- Grants are explicit allow-lists: new tables and functions in public get no
-- access for client roles until a migration grants it.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Shared triggers. Per CLAUDE.md, triggers only maintain server_seq,
-- updated_at and the audit log.

-- One sequence for every synced table, so a single cursor covers them all.
create sequence private.server_seq as bigint;

create function private.set_server_seq()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.server_seq := nextval('private.server_seq');
  return new;
end;
$$;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tenancy

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One per login. `id` is the auth user id. There is deliberately no foreign
-- key to auth.users, so the schema stays plain PostgreSQL.
create table public.profiles (
  id uuid primary key,
  display_name text not null check (btrim(display_name) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  user_id uuid not null references public.profiles (id),
  role text not null check (role in ('super_admin', 'admin', 'staff')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- v1: each user belongs to exactly one shop.
  constraint memberships_user_id_key unique (user_id)
);
create index memberships_tenant_id_idx on public.memberships (tenant_id);

create trigger set_updated_at before update on public.tenants
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.memberships
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Current-user helpers. Only current_user_id knows how the backend identifies
-- the caller (Supabase: auth.uid()); a new backend changes this one function.

create function private.current_user_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select auth.uid()
$$;

-- The caller's shop, or null without an active membership. Security definer so
-- RLS policies can call it without recursing into memberships' own policy.
create function private.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
  from public.memberships m
  where m.user_id = (select private.current_user_id())
    and m.is_active
$$;

create function private.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = (select private.current_user_id())
      and m.is_active
      and m.role in ('admin', 'super_admin')
  )
$$;

revoke execute on all functions in schema private from public;
grant execute on function private.current_user_id() to authenticated;
grant execute on function private.current_tenant_id() to authenticated;
grant execute on function private.current_user_is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Access: members read their own shop, their own membership list and the
-- profiles of people in their shop. No client role may write.

alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;

revoke all on public.tenants, public.profiles, public.memberships from anon, authenticated;
grant select on public.tenants, public.profiles, public.memberships to authenticated;

create policy "Members read their shop"
  on public.tenants for select to authenticated
  using (id = (select private.current_tenant_id()));

create policy "Members read their shop's memberships"
  on public.memberships for select to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy "Members read profiles in their shop"
  on public.profiles for select to authenticated
  using (
    exists (
      select 1
      from public.memberships m
      where m.user_id = profiles.id
        and m.tenant_id = (select private.current_tenant_id())
    )
  );
