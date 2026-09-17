-- =============================================================
-- 株の持ち方・組織の検討（出口とは別に）
--   持株会社／資産管理会社／分社化／種類株／従業員持株会／信託 を、
--   検討中・相談中・実行済・見送りで記録する。税額は持たない（税理士法）。
--   出口の設計（exit_plans）で「持株会社を検討中」にしていたものは、検討中として引き継ぐ
-- =============================================================

create table if not exists public.structure_plans (
  customer_id   uuid primary key references public.profiles(id) on delete cascade,
  items         jsonb not null default '{}'::jsonb,   -- {"holding":{"status":"consider","note":"税理士と相談中"}, ...}
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);
comment on table public.structure_plans is
  '株の持ち方・組織の検討（出口とは別）。持株会社・資産管理会社・分社化・種類株・従業員持株会・信託の検討状況。税額は持たない';
comment on column public.structure_plans.items is
  '種類ごとの状況。status は consider=検討中 / consult=専門家に相談中 / done=実行済 / skip=見送り。note は相談先・時期など';

alter table public.structure_plans enable row level security;
drop policy if exists "structure_plans may" on public.structure_plans;
create policy "structure_plans may" on public.structure_plans
  for all to authenticated
  using (public.customer_may(customer_id))
  with check (public.customer_may(customer_id));

-- ---------------------------------------------------------------
-- 引き継ぎ：出口の設計で「持株会社の設立を検討中」だったもの
-- ---------------------------------------------------------------
insert into public.structure_plans (customer_id, items, updated_at, updated_by)
select customer_id,
       jsonb_build_object('holding', jsonb_build_object('status', 'consider', 'note', coalesce(holding_note, ''))),
       updated_at, updated_by
  from public.exit_plans
 where holding_flag
on conflict (customer_id) do nothing;

-- ---------------------------------------------------------------
-- 確かめ
-- ---------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='structure_plans')                       as "表",
  (select count(*) from pg_policies
    where schemaname='public' and tablename='structure_plans')                           as "RLS",
  (select count(*) from public.structure_plans)                                          as "引き継いだ行",
  (select count(*) from public.exit_plans where holding_flag)                            as "出口で検討中だった数";
--  期待値：表=1、RLS=1、引き継いだ行=出口で検討中だった数（どちらも 0 でも構いません）
-- =============================================================
