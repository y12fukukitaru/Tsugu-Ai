-- =============================================================
-- 企業価値の目標（旗）：経営者が希望を出し、パートナーが旗にする
-- ---------------------------------------------------------------
--  いまの企業価値の画面は、毎月の推移が出るだけで終わっている。
--  数字は動くが、どこへ向かっているのかが無い。「3年後に1億で譲りたい」
--  「あと2年で借金を返し切りたい」——その行き先を置く場所を作る。
--
--  なぜ「希望」と「旗」を分けるのか
--    経営者がひとりで金額を決めても、たいてい根拠が無い。かといって
--    パートナーが決めたものは、経営者の願いではなくなる。
--    だから、まず経営者が希望を出し、パートナーが数字を確かめて旗にする。
--    その一往復が「一緒に見据える」ということだと考えた。
--
--    合意したあとは、経営者ひとりでは金額を書き換えられない。
--    書き換えられるなら、合意に意味が無くなる。変えたいときは、
--    取り下げてもう一度希望から出し直す（＝また一往復する）。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           一度だけ。二度流しても壊れない。
-- =============================================================

create table if not exists public.value_goals (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references auth.users(id) on delete cascade,

  --  いくらを、いつまでに。金額は万円（この画面はすべて万円で通している）
  target_equity  numeric not null check (target_equity > 0),
  target_ym      text    not null check (target_ym ~ '^\d{4}-\d{2}$'),

  --  wish     … 経営者が出した希望。まだ旗ではない
  --  agreed   … パートナーが数字を確かめて旗にした
  --  achieved … 届いた
  --  archived … 取り下げ・作り直し
  status         text not null default 'wish'
                 check (status in ('wish','agreed','achieved','archived')),

  --  なぜその金額なのか。経営者の言葉と、パートナーの見立てを分けて持つ。
  --  混ぜると、あとから「これは誰の言い分だったか」が分からなくなる
  wish_note      text,
  partner_note   text,

  proposed_by    uuid,
  agreed_by      uuid,
  agreed_at      timestamptz,
  achieved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

--  旗は一社にひとつ。希望も同時にふたつは持たない。
--  行き先が複数あるのは、行き先が無いのと同じ
create unique index if not exists value_goals_live_uniq
  on public.value_goals (customer_id) where status in ('wish','agreed');

create index if not exists value_goals_customer_idx
  on public.value_goals (customer_id, created_at desc);

alter table public.value_goals enable row level security;

-- ---- 権限（grant）----
--  Supabase では既定で付くが、それに頼ると既定が変わった日に黙って動かなくなる
grant select, insert, update on public.value_goals to authenticated;
do $do$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.value_goals to service_role';
  end if;
end $do$;

-- ---- 「この顧客は自分の担当か」----
--  cancel_requests と同じ理由で関数に閉じる。権限の中から素直に profiles を
--  読むと、その profiles 自身の権限に縛られ、そちらが変わると黙って効かなくなる。
--  すでに cancel_partner_can_see(uuid) が同じ判定をしているので、それを使う。
--  無い環境（まだ解約のSQLを流していない）でも動くよう、ここでも作っておく
create or replace function public.cancel_partner_can_see(p_customer uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = p_customer and consultant_id = auth.uid()
  );
$$;
revoke all on function public.cancel_partner_can_see(uuid) from public;
grant execute on function public.cancel_partner_can_see(uuid) to authenticated;

-- ---- 経営者本人 ----
--  見るのはいつでも。出すのは自分のぶんだけ。
drop policy if exists "value_goals own read" on public.value_goals;
create policy "value_goals own read" on public.value_goals
  for select to authenticated
  using (customer_id = auth.uid());

drop policy if exists "value_goals own insert" on public.value_goals;
create policy "value_goals own insert" on public.value_goals
  for insert to authenticated
  with check (customer_id = auth.uid() and status = 'wish');

--  ここが要。希望のあいだだけ直せる。
--  using が「直す前」、with check が「直したあと」を見る。両方を wish に
--  縛ることで、経営者は自分で旗に格上げできないし、旗になった金額も動かせない。
--  取り下げ（archived）だけは、旗になったあとでも本人にできてよい。
--  やめたいと言えなくなるほうが困る
drop policy if exists "value_goals own update" on public.value_goals;
create policy "value_goals own update" on public.value_goals
  for update to authenticated
  using (customer_id = auth.uid() and status in ('wish','agreed'))
  with check (
    customer_id = auth.uid()
    and (status = 'wish' or status = 'archived')
  );

-- ---- 担当パートナー ----
--  自分の顧客のぶんを、見る・旗にする。作ることもできる（面談の場で
--  一緒に決めた数字を、その場で入れられたほうがよい）
drop policy if exists "value_goals partner read" on public.value_goals;
create policy "value_goals partner read" on public.value_goals
  for select to authenticated
  using (public.cancel_partner_can_see(customer_id));

drop policy if exists "value_goals partner insert" on public.value_goals;
create policy "value_goals partner insert" on public.value_goals
  for insert to authenticated
  with check (public.cancel_partner_can_see(customer_id));

drop policy if exists "value_goals partner update" on public.value_goals;
create policy "value_goals partner update" on public.value_goals
  for update to authenticated
  using (public.cancel_partner_can_see(customer_id))
  with check (public.cancel_partner_can_see(customer_id));

-- ---- 運営 ----
drop policy if exists "value_goals admin read" on public.value_goals;
create policy "value_goals admin read" on public.value_goals
  for select to authenticated
  using (exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'admin'));

comment on table public.value_goals is
  '企業価値の目標（旗）。経営者が希望を出し、担当パートナーが合意して旗にする';


-- ---------------------------------------------------------------
-- 確認（Run のあとに、これだけ見れば十分）
-- ---------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='value_goals')            as 表,
  (select count(*) from pg_policies
    where schemaname='public' and tablename='value_goals')               as 権限の本数,
  (select count(*) from pg_indexes
    where schemaname='public' and indexname='value_goals_live_uniq')     as 旗はひとつ,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='cancel_partner_can_see')     as 担当判定;
--  期待値：表=1、権限の本数=7、旗はひとつ=1、担当判定=1
-- =============================================================
