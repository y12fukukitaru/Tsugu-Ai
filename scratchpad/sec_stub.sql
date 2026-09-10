-- =============================================================
-- ⛔ これは「試験用の土台」です。本番では絶対に実行しないでください。
--    表を drop します。Supabase の SQL Editor に貼らないこと。
--    使うのは、手元の PostgreSQL に本番の写しを組むときだけです。
-- =============================================================
--  間違えて本番に貼られたときの止め金。Supabase にしかいない役割が
--  見つかったら、何もせずに止まります
do $guard$ begin
  if exists (select 1 from pg_roles
              where rolname in ('supabase_admin','supabase_auth_admin','authenticator')) then
    raise exception
      '⛔ ここは本番です。このファイルは試験用の土台で、表を消します。実行しません。';
  end if;
end $guard$;

drop database if exists sec;
create database sec;
\c sec
create schema if not exists auth;
create schema if not exists storage;
do $$ begin if not exists(select 1 from pg_roles where rolname=$r$anon$r$) then create role anon; end if; end $$;
do $$ begin if not exists(select 1 from pg_roles where rolname=$r$authenticated$r$) then create role authenticated; end if; end $$;
do $$ begin if not exists(select 1 from pg_roles where rolname=$r$service_role$r$) then create role service_role; end if; end $$;

--  auth.uid() を差し替えられるようにする（試験用）
create table auth.whoami(id uuid);
create or replace function auth.uid() returns uuid
  language sql stable as $$ select id from auth.whoami limit 1 $$;

create table public.profiles(
  id uuid primary key, role text, consultant_id uuid, email text, company_name text);
create table public.partner_assignments(
  customer_id uuid, main_id uuid, sub_id uuid, status text);
create table public.ep_orgs(id uuid primary key, kind text, name text);
create table public.ep_members(ep_id uuid, user_id uuid, status text, seat_role text);
create table public.ep_clients(ep_id uuid, customer_id uuid, status text);
create table public.ep_grants(ep_id uuid, member_id uuid, customer_id uuid, revoked_at timestamptz);

create table public.contract_offers(
  id uuid primary key default gen_random_uuid(),
  kind text, token text not null unique check (length(token)>=32),
  email text, body text, monthly_fee numeric, status text default 'sent',
  offered_by uuid, consultant_id uuid, claimed_user_id uuid,
  expires_at timestamptz default now()+interval '30 days');
alter table public.contract_offers enable row level security;
grant select, insert, update on public.contract_offers to authenticated;

create table storage.objects(
  id uuid primary key default gen_random_uuid(),
  bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
grant select, insert on storage.objects to authenticated;
create policy "chat attach read" on storage.objects
  for select to authenticated using (bucket_id='chat-attach');
create policy "chat attach upload" on storage.objects
  for insert to authenticated with check (bucket_id='chat-attach');
grant usage on schema public, storage, auth to authenticated, anon;
grant select on public.profiles to authenticated;
grant select on auth.whoami to authenticated;
