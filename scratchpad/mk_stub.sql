-- =============================================================
-- ⛔ これは「試験用の土台」です。本番では絶対に実行しないでください。
--    Supabase の SQL Editor に貼らないこと。
-- =============================================================
do $guard$ begin
  if exists (select 1 from pg_roles
              where rolname in ('supabase_admin','supabase_auth_admin','authenticator')) then
    raise exception '⛔ ここは本番です。このファイルは試験用の土台です。実行しません。';
  end if;
end $guard$;

\c sec
create table if not exists public.market_listings(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid, side text, kind text, title text, status text default 'open', created_at timestamptz default now());
alter table public.market_listings enable row level security;
grant select on public.market_listings to authenticated;
drop policy if exists "ml open read" on public.market_listings;
create policy "ml open read" on public.market_listings for select to authenticated using (status='open' or owner_id=auth.uid());
