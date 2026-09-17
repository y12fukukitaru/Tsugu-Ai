-- =============================================================
-- スケールの設計（大きくする道を選び、数字で追う）
--   主軸の道・目標の年・見る数字の目標・道ごとの取り組み（検討中／取り組み中／済／見送り）
--   経営者と担当パートナーが同じ行を読み書きする（customer_may）。税額は持たない
-- =============================================================

create table if not exists public.scale_plans (
  customer_id   uuid primary key references public.profiles(id) on delete cascade,
  main          text check (main in ('deepen','pillar','buy','debt','equity','group','list')),
  target_year   integer,
  targets       jsonb not null default '{}'::jsonb,   -- {"revY":万円,"opY":万円,"cashM":か月,"pillars":本}
  items         jsonb not null default '{}'::jsonb,   -- {"debt":{"status":"doing","note":"公庫に相談中"}, ...}
  notes         text,
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);
comment on table public.scale_plans is
  'スケールの設計。主軸の道（deepen=いまの事業を深める / pillar=柱を増やす / buy=M&Aで買う / debt=デットで加速 / equity=エクイティで加速 / group=グループ化 / list=上場で加速）、目標の年、見る数字の目標、道ごとの取り組み';
comment on column public.scale_plans.items is
  '道ごとの状況。status は consider=検討中 / doing=取り組み中 / done=済 / skip=見送り。note は何を・いつまでに';

alter table public.scale_plans enable row level security;
drop policy if exists "scale_plans may" on public.scale_plans;
create policy "scale_plans may" on public.scale_plans
  for all to authenticated
  using (public.customer_may(customer_id))
  with check (public.customer_may(customer_id));

-- ---------------------------------------------------------------
-- 確かめ
-- ---------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='scale_plans')                           as "表",
  (select count(*) from pg_policies
    where schemaname='public' and tablename='scale_plans')                               as "RLS",
  (select count(*) from pg_constraint
    where conrelid='public.scale_plans'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%deepen%')                                     as "主軸の制約";
--  期待値：表=1、RLS=1、主軸の制約=1
-- =============================================================
