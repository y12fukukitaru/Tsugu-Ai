-- =============================================================
-- 旗までの打ち手：何をどれだけやれば届くのかを、分担して置く
-- ---------------------------------------------------------------
--  旗を立て、「月あたり+67万円」までは出せるようになった。
--  だが、その67万円を何で埋めるのかが無いままだと、結局は精神論になる。
--
--  だから打ち手を並べ、それぞれが月いくらを担うのかを置く。
--  そのうえで「必要な額」と「打ち手の合計」を突き合わせる。
--    足りていなければ、あと何万円ぶんの打ち手が要るかが分かる。
--    そこが埋まって初めて、旗は「届く見込みのある旗」になる。
--
--  旗（value_goals）と違って、ここは経営者もパートナーも自由に足せる。
--  旗は約束なので一往復を要ったが、打ち手は作業台で、
--  思いついた人がその場で置けるほうがよい。
--
--  経営課題（pdca_items）とつなげられるようにしてある。すでに走っている
--  取り組みが旗に効いているなら、別物として二重に管理する意味がない。
--
-- 先に実行しておく SQL: 20260904000000_value_goals.sql
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
-- =============================================================

create table if not exists public.value_goal_actions (
  id             uuid primary key default gen_random_uuid(),
  goal_id        uuid not null references public.value_goals(id) on delete cascade,
  --  権限の判定に使う。goal を辿れば分かるが、辿るとその value_goals 側の
  --  権限に縛られる。cancel_requests で一度踏んだ落とし穴なので、ここに持つ
  customer_id    uuid not null references auth.users(id) on delete cascade,

  title          text not null check (length(btrim(title)) > 0),
  note           text,

  --  打ち手には二種類ある。利益を上げるものと、借入を減らすもの。
  --  効き方が違うので、同じ列で足すと嘘になる。
  --    profit … 月あたりの利益改善（万円/月）
  --             年で12倍され、さらに倍率が掛かって企業価値になる
  --    debt   … 借入の圧縮額（万円・一括）
  --             1万円返せば企業価値がそのまま1万円上がる
  --  画面ではこの二つを企業価値に換算してから合計する
  kind           text not null default 'profit' check (kind in ('profit','debt')),

  --  いくらを担うか。0や空でもよい——効果額を置けない打ち手（体制づくり
  --  など）を、置けないからと諦めさせない
  monthly_impact numeric default 0,

  --  すでに走っている経営課題があるなら、それに紐づける
  pdca_item_id   uuid,

  status         text not null default 'open'
                 check (status in ('open','done','dropped')),
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists value_goal_actions_goal_idx
  on public.value_goal_actions (goal_id, status, created_at);

alter table public.value_goal_actions enable row level security;

-- ---- 権限（grant）----
grant select, insert, update, delete on public.value_goal_actions to authenticated;
do $do$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.value_goal_actions to service_role';
  end if;
end $do$;

-- ---- 経営者本人と担当パートナー：どちらも置ける・直せる・消せる ----
--  ここは作業台。思いついた人がその場で置けるほうがよい。
--  旗のような一往復は要らない（旗は約束、打ち手は手立て）
drop policy if exists "value_goal_actions own" on public.value_goal_actions;
create policy "value_goal_actions own" on public.value_goal_actions
  for all to authenticated
  using (customer_id = auth.uid())
  with check (customer_id = auth.uid());

drop policy if exists "value_goal_actions partner" on public.value_goal_actions;
create policy "value_goal_actions partner" on public.value_goal_actions
  for all to authenticated
  using (public.cancel_partner_can_see(customer_id))
  with check (public.cancel_partner_can_see(customer_id));

drop policy if exists "value_goal_actions admin read" on public.value_goal_actions;
create policy "value_goal_actions admin read" on public.value_goal_actions
  for select to authenticated
  using (exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'admin'));

comment on table public.value_goal_actions is
  '旗までの打ち手。それぞれが月あたりいくらを担うかを置き、必要額と突き合わせる';


-- ---------------------------------------------------------------
-- 確認（Run のあとに、これだけ見れば十分）
-- ---------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='value_goal_actions')      as 表,
  (select count(*) from pg_policies
    where schemaname='public' and tablename='value_goal_actions')         as 権限の本数,
  (select count(*) from information_schema.table_constraints
    where table_schema='public' and table_name='value_goal_actions'
      and constraint_type='FOREIGN KEY')                                  as 外部キー;
--  期待値：表=1、権限の本数=3、外部キー=2
--  外部キーは2本（旗と、経営者本人）。旗を下ろすと打ち手も一緒に片づく
-- =============================================================
