-- =============================================================
-- ⛔ これは「試験用の土台」です。本番では絶対に実行しないでください。
--    表を drop します。Supabase の SQL Editor に貼らないこと。
-- =============================================================
do $guard$ begin
  if exists (select 1 from pg_roles
              where rolname in ('supabase_admin','supabase_auth_admin','authenticator')) then
    raise exception '⛔ ここは本番です。このファイルは試験用の土台で、表を消します。実行しません。';
  end if;
end $guard$;

drop schema if exists auth cascade;
create schema auth;
create table auth.users (id uuid primary key, email text);
drop table if exists public.__me cascade;
create table public.__me (id uuid);
create or replace function auth.uid() returns uuid language sql stable as $$ select id from public.__me limit 1 $$;

drop table if exists public.setup_fee_notices, public.debit_mandates, public.invoices, public.contract_offers,
  public.profiles, public.app_settings, public.account_deletions cascade;
drop sequence if exists public.debit_mandate_no_seq;
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text, plan text, consultant_id uuid, company_name text, contact_name text, created_at timestamptz default now());
create table public.app_settings (key text primary key, value jsonb);
create table public.account_deletions (deleted_user_id uuid);
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  period text not null, kind text not null, title text, amount_ex integer, tax integer, amount integer,
  due_on date, status text not null default 'open', paid_amount integer default 0, paid_on date,
  method text, note text, void_reason text, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.contract_offers (
  id uuid primary key default gen_random_uuid(), kind text, plan text, email text, status text,
  claimed_user_id uuid);
create or replace function public.invoice_is_admin() returns boolean language sql security definer stable
  set search_path = public as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') $$;

do $r$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
end $r$;
grant usage on schema public to authenticated, anon;
grant select on public.profiles, public.app_settings, public.invoices, public.contract_offers to authenticated;
grant insert, update, delete on public.__me to authenticated;
grant select on public.__me to authenticated;

create or replace function public.be(p uuid) returns void language sql as $$ delete from public.__me; insert into public.__me values (p); $$;

drop table if exists public.__t;
create table public.__t (n serial, name text, got text, want text);
create or replace function public.chk(p_name text, p_got anyelement, p_want anyelement) returns void
  language sql as $$ insert into public.__t(name, got, want) values (p_name, p_got::text, p_want::text) $$;
grant insert, select on public.__t to authenticated;
grant usage on sequence public.__t_n_seq to authenticated;
