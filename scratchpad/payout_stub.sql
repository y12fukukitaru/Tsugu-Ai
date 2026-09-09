-- 口座まわりの試験用の最小限の写し
drop schema if exists auth cascade;
create schema auth;
create table auth.users (id uuid primary key, email text);
create table if not exists public.__me (id uuid);
create or replace function auth.uid() returns uuid
  language sql stable as $$ select id from public.__me limit 1 $$;

drop table if exists public.payout_accounts cascade;
drop table if exists public.payout_account_reads cascade;
drop table if exists public.payout_keys cascade;
drop table if exists public.profiles cascade;
drop table if exists public.ep_orgs cascade;
drop table if exists public.ep_members cascade;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text, email text, full_name text, company_name text, contact_name text,
  consultant_id uuid, created_at timestamptz default now()
);
create table public.ep_orgs (id uuid primary key, name text, kind text);
create table public.ep_members (ep_id uuid, user_id uuid, seat_role text, status text);

do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
end $$;
grant usage on schema public to authenticated, anon;
grant select on public.profiles, public.ep_orgs, public.ep_members to authenticated;

create or replace function public.be(p uuid) returns void
  language sql as $$ delete from public.__me; insert into public.__me values (p); $$;
