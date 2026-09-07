-- 本番にある表の、試験用の最小限の写し
drop schema if exists auth cascade;
create schema auth;
create table auth.users (id uuid primary key, email text);

create table if not exists public.__me (id uuid);
create or replace function auth.uid() returns uuid
  language sql stable as $$ select id from public.__me limit 1 $$;

drop table if exists public.invoices cascade;
drop table if exists public.profiles cascade;
drop table if exists public.app_settings cascade;
drop table if exists public.account_deletions cascade;
drop table if exists public.revenue_entries cascade;
drop table if exists public.company_members cascade;
drop table if exists public.partner_assignments cascade;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text, email text, full_name text, company_name text, contact_name text,
  consultant_id uuid, created_at timestamptz default now()
);
create table public.app_settings (key text primary key, value jsonb, updated_at timestamptz default now());
create table public.account_deletions (deleted_user_id uuid);
create table public.revenue_entries (
  id uuid primary key default gen_random_uuid(),
  occurred_on date, category text, amount integer,
  customer_id uuid, counterparty text, description text,
  created_by uuid, created_at timestamptz default now()
);
create table public.company_members (customer_id uuid, member_id uuid, status text);
create table public.partner_assignments (customer_id uuid, main_id uuid, sub_id uuid, status text);

create role authenticated;
create role anon;
grant usage on schema public to authenticated, anon;
grant select on public.profiles, public.app_settings, public.revenue_entries,
                public.company_members, public.partner_assignments to authenticated;

create or replace function public.be(p uuid) returns void
  language sql as $$ delete from public.__me; insert into public.__me values (p); $$;
