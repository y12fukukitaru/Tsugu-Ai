-- ⛔ 試験用の土台（手元の PostgreSQL 専用）。Supabase では絶対に流さない
do $guard$ begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin','supabase_auth_admin','authenticator')) then
    raise exception '⛔ ここは本番です。実行しません。';
  end if;
end $guard$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create table if not exists public.__me (id uuid);
create or replace function auth.uid() returns uuid language sql stable as $$ select id from public.__me limit 1 $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select jsonb_build_object('email', (select u.email from auth.users u join public.__me m on m.id=u.id limit 1)) $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
grant usage on schema public, auth to authenticated, anon;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text, email text, full_name text, company_name text, contact_name text,
  consultant_id uuid, created_at timestamptz default now(), onboard_start date
);
create table public.app_settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
create table public.contract_templates (
  id uuid primary key default gen_random_uuid(), kind text not null, version int not null,
  title text not null, body text not null, active boolean not null default false,
  created_by uuid, created_at timestamptz not null default now(), unique (kind, version));
create table public.contract_offers (
  id uuid primary key default gen_random_uuid(),
  kind text not null, token text not null unique, email text not null,
  template_id uuid, template_version int, title text, body text,
  monthly_fee numeric, consultant_id uuid, offered_by uuid not null,
  status text not null default 'sent' check (status in ('sent','agreed','cancelled')),
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  claimed_user_id uuid, agreed_at timestamptz, agreed_name text, agreed_org text,
  agreed_body text, agreed_ua text, ep_id uuid, notified_at timestamptz, created_at timestamptz not null default now()
);
create table public.agent_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, customer_id uuid, kind text not null, title text not null, body text not null,
  reason text, priority int not null default 2, status text not null default 'unread', created_at timestamptz not null default now()
);
create table public.ep_orgs (id uuid primary key, name text, kind text);
create table public.invoices (
  id uuid primary key default gen_random_uuid(), customer_id uuid not null, period text not null, kind text not null,
  title text, amount_ex integer, tax integer, amount integer, due_on date, status text not null default 'open',
  paid_amount integer default 0, created_at timestamptz default now(), unique (customer_id, period, kind));
create table public.account_deletions (deleted_user_id uuid);
create or replace function public.invoice_is_admin() returns boolean language sql stable security definer as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') $$;
create or replace function public.chat_att_may(p uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.profiles me where me.id = auth.uid()
     and (me.role = 'admin' or me.id = p or exists (select 1 from public.profiles c where c.id = p and c.consultant_id = me.id))) $$;
create or replace function public.customer_may(p uuid) returns boolean language sql stable security definer as $$ select public.chat_att_may(p) $$;
create or replace function public.contract_fill(p_body text, p_email text, p_fee numeric, p_name text, p_date date, p_org text default null, p_hq text default null)
returns text language sql immutable as $$
  select replace(replace(replace(coalesce(p_body,''), '{{メールアドレス}}', coalesce(p_email,'')), '{{お名前}}', coalesce(p_name,'')),
                 '{{月額}}', case when p_fee is null then '—' else to_char(p_fee,'FM999,999,999') || '円' end) $$;
create or replace function public.contract_notify_agreed(p uuid) returns integer language sql as $$ select 0 $$;
create or replace function public.be(p uuid) returns void language sql as $$ delete from public.__me; insert into public.__me values (p); $$;

insert into auth.users values
  ('00000000-0000-0000-0000-0000000000c1','c1@x.jp'),('00000000-0000-0000-0000-0000000000c2','c2@x.jp'),
  ('00000000-0000-0000-0000-0000000000b1','p1@x.jp'),('00000000-0000-0000-0000-0000000000a1','a1@x.jp'),
  ('00000000-0000-0000-0000-0000000000c3','new@x.jp');
insert into public.profiles (id, role, email, company_name, consultant_id, created_at) values
  ('00000000-0000-0000-0000-0000000000c1','customer','c1@x.jp','A社','00000000-0000-0000-0000-0000000000b1', now() - interval '400 days'),
  ('00000000-0000-0000-0000-0000000000c2','customer','c2@x.jp','B社','00000000-0000-0000-0000-0000000000a1', now() - interval '30 days'),
  ('00000000-0000-0000-0000-0000000000b1','consultant','p1@x.jp',null,null, now()),
  ('00000000-0000-0000-0000-0000000000a1','admin','a1@x.jp',null,null, now()),
  ('00000000-0000-0000-0000-0000000000c3','customer','new@x.jp',null,null, now());
insert into public.contract_templates (kind, version, title, body, active) values
  ('partner', 1, 'パートナー契約（仮）', '本文', true),
  ('customer', 1, '顧問契約書（仮）', E'■ 契約者\n  メールアドレス：{{メールアドレス}}\n  お名前：{{お名前}}\n  顧問料：月額 {{月額}}\n\n第1条（目的）\n  …\n\n第2条（顧問料）\n  乙は甲に対し、前記の顧問料を毎月お支払いいただきます。\n  お支払いの方法および期日は、別途ご案内します。\n\n第2条の2（初期導入費）\n  …\n\n第3条（成果の非保証）\n  …\n', true);
