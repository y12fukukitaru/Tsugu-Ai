-- 手元の PostgreSQL に、Supabase の最低限の土台を作る（アンケート SQL の試験用）
--  Supabase では絶対に流さない
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')::uuid
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
grant usage on schema public to authenticated, anon, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;

create table if not exists public.profiles (id uuid primary key, role text, email text);
alter table public.profiles enable row level security;
create policy "profiles read" on public.profiles for select to authenticated using (true);
create table if not exists public.app_settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
create table if not exists public.contract_templates (
  id uuid primary key default gen_random_uuid(), kind text not null, version int not null,
  title text not null, body text not null, active boolean not null default false,
  created_by uuid, created_at timestamptz not null default now(), unique (kind, version));

insert into auth.users values
  ('00000000-0000-0000-0000-0000000000c1','c1@x.jp'),('00000000-0000-0000-0000-0000000000c2','c2@x.jp'),
  ('00000000-0000-0000-0000-0000000000b1','p1@x.jp'),('00000000-0000-0000-0000-0000000000a1','a1@x.jp');
insert into public.profiles values
  ('00000000-0000-0000-0000-0000000000c1','customer','c1@x.jp'),('00000000-0000-0000-0000-0000000000c2','customer','c2@x.jp'),
  ('00000000-0000-0000-0000-0000000000b1','consultant','p1@x.jp'),('00000000-0000-0000-0000-0000000000a1','admin','a1@x.jp');
insert into public.contract_templates (kind, version, title, body, active) values
  ('partner', 1, 'パートナー契約（仮）', '本文', true),
  ('customer', 1, '顧問契約書（仮）', E'第1条（目的）\n  …\n\n第2条（顧問料）\n  …\n\n第3条（成果の非保証）\n  …\n', true);
