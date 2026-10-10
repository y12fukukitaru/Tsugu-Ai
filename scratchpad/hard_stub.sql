-- =============================================================
-- ⛔ これは「試験用の土台」です。本番では絶対に実行しないでください。
--    手元の PostgreSQL に、情報の守り（20261010000000_security_hardening.sql）を
--    試すための最小限の写しを組みます。Supabase の SQL Editor に貼らないこと。
-- =============================================================
do $guard$ begin
  if exists (select 1 from pg_roles
              where rolname in ('supabase_admin','supabase_auth_admin','authenticator')) then
    raise exception '⛔ ここは本番です。このファイルは試験用の土台で、表を消します。実行しません。';
  end if;
end $guard$;

do $r$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $r$;
grant usage on schema public to authenticated, anon, service_role;

create schema auth;
create table auth.users (id uuid primary key, email text);
create table public.__me (id uuid, email text);
grant select on public.__me to authenticated, anon;
create or replace function auth.uid() returns uuid language sql stable as $$ select id from public.__me limit 1 $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', email) from public.__me limit 1 $$;
grant usage on schema auth to authenticated, anon, service_role;
grant execute on function auth.uid(), auth.jwt() to authenticated, anon;

create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
insert into storage.buckets(id,name,public) values ('chat-attach','chat-attach',false),('license-docs','license-docs',false);

create table public.profiles (
  id uuid primary key, role text, email text, full_name text, company_name text,
  consultant_id uuid, admin_role text, admin_perms jsonb, plan text default 'seller', plan_from date, plan_prev text,
  fde_rank text, onboarded boolean);
alter table public.profiles enable row level security;
grant select, insert, update on public.profiles to authenticated;
create policy p_sel on public.profiles for select to authenticated using (true);
create policy p_upd_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy p_upd_partner on public.profiles for update to authenticated using (consultant_id = auth.uid()) with check (true);
create policy p_upd_admin on public.profiles for update to authenticated using (exists(select 1 from public.profiles a where a.id=auth.uid() and a.role='admin')) with check (true);
create policy p_ins_own on public.profiles for insert to authenticated with check (id = auth.uid());

create or replace function public.is_owner() returns boolean language sql stable security definer set search_path=public as
  $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and admin_role='owner') $$;
grant execute on function public.is_owner() to authenticated;

--  「招待を受け取る」に当たる、運営が用意した関数の代わり
create or replace function public.claim_test(p_customer uuid, p_cons uuid) returns void language sql security definer set search_path=public as
  $$ update public.profiles set consultant_id = p_cons where id = p_customer $$;
create or replace function public.claim_client(p_email text) returns text language sql security definer set search_path=public as $$ select 'ok' $$;
grant execute on function public.claim_test(uuid,uuid), public.claim_client(text) to authenticated, anon;

create table public.notify_prefs (user_id uuid primary key, event_on boolean default true);

create table public.company_members (id uuid primary key default gen_random_uuid(), customer_id uuid, member_id uuid, member_email text, status text, access text);
create table public.partner_assignments (id uuid primary key default gen_random_uuid(), customer_id uuid, main_id uuid, sub_id uuid, sub_email text,
  status text, main_share int, sub_share int, decided_at timestamptz, admin_note text, reason text);
alter table public.company_members enable row level security;
alter table public.partner_assignments enable row level security;
grant select, insert, update, delete on public.company_members, public.partner_assignments to authenticated;
--  点検で心配された「緩いままかもしれない」形をわざと置く（トリガーだけで守れるかを見る）
create policy cm_all on public.company_members for all to authenticated using (true) with check (true);
create policy pa_all on public.partner_assignments for all to authenticated using (true) with check (true);

--  使う人
insert into public.profiles(id,role,email,consultant_id,admin_role) values
 ('00000000-0000-0000-0000-0000000000a1','admin','owner@x','00000000-0000-0000-0000-000000000000','owner'),
 ('00000000-0000-0000-0000-0000000000a2','admin','staff@x',null,'staff'),
 ('00000000-0000-0000-0000-0000000000b1','consultant','p1@x',null,null),
 ('00000000-0000-0000-0000-0000000000b2','consultant','p2@x',null,null),
 ('00000000-0000-0000-0000-0000000000b3','consultant','p3@x',null,null),
 ('00000000-0000-0000-0000-0000000000c1','customer','c1@x','00000000-0000-0000-0000-0000000000b1',null),
 ('00000000-0000-0000-0000-0000000000c2','customer','c2@x','00000000-0000-0000-0000-0000000000b2',null),
 ('00000000-0000-0000-0000-0000000000c3','customer','c3@x','00000000-0000-0000-0000-0000000000b3',null);
insert into auth.users(id,email) select id,email from public.profiles;
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000d1','d1@x'),('00000000-0000-0000-0000-0000000000d2','tax@x');
--  二段階認証（20261010010000_mfa_required.sql）の試験用
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, factor_type text default 'totp', status text);
alter table public.__me add column aal text;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', email, 'aal', coalesce(aal,'aal1')) from public.__me limit 1 $$;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
grant select, insert on storage.objects to authenticated;
grant usage on schema storage to authenticated;
create policy obj_own on storage.objects for select to authenticated using (owner = auth.uid());
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid);
