-- =============================================================
-- ⛔ これは「試験用の土台」です。本番では絶対に実行しないでください。
--    表を drop します。Supabase の SQL Editor に貼らないこと。
-- =============================================================
do $guard$ begin
  if exists (select 1 from pg_roles
              where rolname in ('supabase_admin','supabase_auth_admin','authenticator')) then
    raise exception
      '⛔ ここは本番です。このファイルは試験用の土台で、表を消します。実行しません。';
  end if;
end $guard$;

\c sec
drop table if exists public.billing_links cascade;
drop table if exists public.announcements cascade;
drop table if exists public.contract_templates cascade;
create table public.billing_links(
  id uuid primary key default gen_random_uuid(),
  audience text, label text, description text, url text,
  customer_id uuid, active boolean default true, sort int default 0);
create table public.announcements(
  id uuid primary key default gen_random_uuid(),
  audience text, title text, body text, created_by uuid,
  created_at timestamptz default now());
create table public.contract_templates(
  id uuid primary key default gen_random_uuid(),
  kind text, title text, body text, version int default 1, active boolean default true);
grant select, insert, update, delete on public.billing_links, public.announcements,
      public.contract_templates to authenticated;
alter table public.billing_links enable row level security;
alter table public.announcements enable row level security;
alter table public.contract_templates enable row level security;
-- 直す前の姿（点検で見えたもの）
create policy "billing_links_read" on public.billing_links for select to authenticated using (true);
create policy "announcements_select" on public.announcements for select to authenticated using (true);
create policy "contract_templates read active" on public.contract_templates
  for select to authenticated using (active);
