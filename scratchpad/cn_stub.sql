-- =============================================================
-- ⛔ これは「試験用の土台」です。本番では絶対に実行しないでください。
--    表を drop します。Supabase の SQL Editor に貼らないこと。
--    使うのは、手元の PostgreSQL に本番の写しを組むときだけです。
-- =============================================================
do $guard$ begin
  if exists (select 1 from pg_roles
              where rolname in ('supabase_admin','supabase_auth_admin','authenticator')) then
    raise exception
      '⛔ ここは本番です。このファイルは試験用の土台で、表を消します。実行しません。';
  end if;
end $guard$;

-- 契約の締結の知らせ・招待の試験用の最小限の写し
drop schema if exists auth cascade;
create schema auth;
create table auth.users (id uuid primary key, email text);
create table if not exists public.__me (id uuid);
create or replace function auth.uid() returns uuid
  language sql stable as $$ select id from public.__me limit 1 $$;
create or replace function auth.jwt() returns jsonb
  language sql stable as $$
    select jsonb_build_object('email', (select u.email from auth.users u join public.__me m on m.id=u.id limit 1)) $$;

drop table if exists public.agent_insights cascade;
drop table if exists public.contract_offers cascade;
drop table if exists public.customer_invites cascade;
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
create table public.customer_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null, consultant_id uuid not null, company_name text, note text,
  status text not null default 'pending' check (status in ('pending','claimed','cancelled')),
  created_at timestamptz not null default now(), claimed_at timestamptz, claimed_id uuid
);
create table public.contract_offers (
  id uuid primary key default gen_random_uuid(),
  kind text not null, token text not null unique, email text not null,
  template_id uuid, template_version int, title text, body text,
  monthly_fee numeric, consultant_id uuid, offered_by uuid not null,
  status text not null default 'sent' check (status in ('sent','agreed','cancelled')),
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  claimed_user_id uuid, agreed_at timestamptz, agreed_name text, agreed_org text,
  agreed_body text, agreed_ua text, ep_id uuid, created_at timestamptz not null default now()
);
create table public.agent_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, customer_id uuid, kind text not null, title text not null, body text not null,
  reason text, priority int not null default 2, status text not null default 'unread', feedback text,
  created_at timestamptz not null default now()
);
alter table public.contract_offers enable row level security;
alter table public.agent_insights enable row level security;

do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
end $$;
grant usage on schema public, auth to authenticated, anon;
grant select on public.profiles, public.ep_orgs, public.ep_members, public.__me to authenticated;
grant select on auth.users to authenticated;
grant select, insert, update on public.customer_invites, public.contract_offers to authenticated;

--  本番の contract_fill（7引数）の代わり。差し込みだけ真似る
create or replace function public.contract_fill(
  p_body text, p_email text, p_fee numeric, p_name text, p_date date,
  p_org text default null, p_hq text default null)
returns text language sql immutable as $$
  select replace(replace(coalesce(p_body,''), '{{メールアドレス}}', coalesce(p_email,'')), '{{お名前}}', coalesce(p_name,''))
$$;
create or replace function public.ep_may_send_customer_contract()
returns boolean language sql security definer stable set search_path = public as $$
  select not exists (
    select 1 from public.ep_members m join public.ep_orgs o on o.id = m.ep_id
     where m.user_id = auth.uid() and m.status = 'active' and o.kind = 'EP1' and m.seat_role <> 'manager')
$$;
create or replace function public.be(p uuid) returns void
  language sql as $$ delete from public.__me; insert into public.__me values (p); $$;
