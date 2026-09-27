-- =============================================================
-- 継ナビくんの TODO（やること）
-- ---------------------------------------------------------------
--  「忘れない」ための自分用の控え。予定（agenda_events）は時刻のある
--  約束、課題（pdca_items）は顧客と一緒に進めるもの。TODO はそのどちらでもない、
--  自分がやると決めた小さな用事（「◯◯社に資料を送る」「保険証券を返す」など）。
--
--  ・本人だけが見て、書ける（運営・担当パートナー・顧客には見えない）
--  ・期限（日付）は任意。時刻も任意。期限のあるものは「予定」タブの暦に並び、
--    期限が今日まで（期限切れを含む）のものは、毎朝の「今日の一手」（パートナー）と
--    毎週月曜の「今週のひとこと」（経営者、今週が期限のもの）の頭に出る
--  ・パートナーは担当顧客をひも付けられる（どの会社の用事か）
--  ・済んだら done_at に日時を入れる。行は消さずに残せる（消すこともできる）
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度流しても同じ結果になります。
--           毎朝・毎週の便りに出すには Edge Function agent-heartbeat の更新も要ります。
--
-- 確かめかた：表=1、権限（表）=1、索引=2
-- =============================================================

create table if not exists public.todos (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null,
  note        text,
  due_date    date,
  due_time    time,
  customer_id uuid references auth.users(id) on delete set null,
  done_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.todos drop constraint if exists todos_title_check;
alter table public.todos add constraint todos_title_check
  check (char_length(btrim(title)) between 1 and 200);

create index if not exists todos_owner_open_idx on public.todos (owner_id, due_date) where done_at is null;
create index if not exists todos_due_idx on public.todos (due_date) where done_at is null;

create or replace function public.todos_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists todos_touch on public.todos;
create trigger todos_touch before update on public.todos
  for each row execute function public.todos_touch();

alter table public.todos enable row level security;

grant select, insert, update, delete on public.todos to authenticated;
do $do$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.todos to service_role';
  end if;
end $do$;

--  本人だけ。ひも付けた顧客の行を読めるかどうかは、この表とは関係ない
drop policy if exists "todos own" on public.todos;
create policy "todos own" on public.todos
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

comment on table public.todos is
  '継ナビくんの TODO。本人だけが見る自分用の控え。期限のあるものは予定・今日の一手・今週のひとことに出る';

-- ---------------------------------------------------------------
-- 確かめかた
-- ---------------------------------------------------------------
-- select
--   (select count(*) from pg_tables where schemaname='public' and tablename='todos')  as "表=1",
--   (select count(*) from pg_policies where tablename='todos')                         as "権限（表）=1",
--   (select count(*) from pg_indexes where tablename='todos' and indexname like 'todos_%_idx') as "索引=2";
