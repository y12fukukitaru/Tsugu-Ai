-- =============================================================
-- 経営者が「買い手として動く」ための二つの表
-- ---------------------------------------------------------------
--  ゴールは「顧問先が買い手になり、会社を買って柱を増やす」です。
--  ところが経営者の画面には、買う意思を表明する一手がありませんでした。
--  どの画面のボタンも「担当パートナーにメッセージで相談」で、
--  Tsugime の案件を見ても「関心を出す」がない。関心の表
--  （market_interests）は本番にあるのに、経営者から書き込む道が
--  画面に無かった。
--
--  ■ 買いたい条件（buy_criteria）
--    業種・地域・年商の目安・予算・目的・メモ。経営者が自分で書く。
--    パートナーは代行で書ける（会社情報と同じ考え方）。
--    パートナーが案件を探す起点になる。
--
--  ■ 関心（market_interests）
--    表は既にある。経営者が自分の関心を書き込めるよう、決まりを足す。
--    一つの案件に同じ人が二度出せないよう、一意にしておく。
--    担当パートナーが顧客の関心を読めるようにする。
--
--  ■ 見てよい人の判定
--    添付で作った chat_att_may（本人・担当・承認済みの副担当・EPの
--    管理者・個別の閲覧権・運営）と同じ。名前だけ customer_may に
--    改めて、添付以外でも使えるようにする。判定の中身は一つに保つ。
--
--  確かめかた：買いたい条件の表=1、買いたい条件の見張り=1、
--              関心の書き込み=1、関心の担当読み=1、関心の一意=1
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度流しても同じ結果になります。
-- =============================================================

-- ---------------------------------------------------------------
-- ① 「その会社に関わる人か」を、添付以外でも使える名前で
-- ---------------------------------------------------------------
create or replace function public.customer_may(p_customer uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.chat_att_may(p_customer);
$$;
revoke all on function public.customer_may(uuid) from public, anon;
grant execute on function public.customer_may(uuid) to authenticated;

-- ---------------------------------------------------------------
-- ② 買いたい条件
-- ---------------------------------------------------------------
create table if not exists public.buy_criteria (
  customer_id uuid primary key references public.profiles(id) on delete cascade,
  industries  text,          -- 業種（自由記述。「製造業、建設業」など）
  region      text,          -- 地域
  size_note   text,          -- 年商・規模の目安（「年商1〜3億円」など）
  budget_man  integer,       -- 予算（万円）
  purpose     text,          -- 目的（売上・シェア拡大／人材・技術／エリア／川上川下／その他）
  memo        text,
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);
comment on table public.buy_criteria is
  '経営者の「買いたい条件」。パートナーが案件を探す起点。経営者本人とパートナーの両方が書ける';

alter table public.buy_criteria enable row level security;
revoke all on public.buy_criteria from anon;
grant select, insert, update on public.buy_criteria to authenticated;
do $do$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.buy_criteria to service_role';
  end if;
end $do$;

--  本人・担当・副担当・EP管理者・運営。読むのも書くのも同じ範囲
drop policy if exists "buy_criteria may" on public.buy_criteria;
create policy "buy_criteria may" on public.buy_criteria
  for all to authenticated
  using (public.customer_may(customer_id))
  with check (public.customer_may(customer_id));

-- ---------------------------------------------------------------
-- ③ 関心：経営者が自分で出せるように
-- ---------------------------------------------------------------
--  表は本番に既にある。無い環境のために、同じ形で作っておく
create table if not exists public.market_interests (
  id         uuid primary key default gen_random_uuid(),
  listing_id uuid not null,
  from_id    uuid not null,
  message    text,
  created_at timestamptz not null default now()
);
alter table public.market_interests enable row level security;
grant select, insert on public.market_interests to authenticated;

--  同じ案件に同じ人が二度出さない
create unique index if not exists market_interests_once
  on public.market_interests (listing_id, from_id);

--  自分の関心を、公開中の・自分のものではない案件にだけ出せる
drop policy if exists "market_interests own insert" on public.market_interests;
create policy "market_interests own insert" on public.market_interests
  for insert to authenticated
  with check (
    from_id = auth.uid()
    and exists (select 1 from public.market_listings l
                 where l.id = market_interests.listing_id
                   and l.status = 'open'
                   and l.owner_id <> auth.uid())
  );

--  自分の関心は読める。担当パートナーは顧客の関心を読める
drop policy if exists "market_interests own read" on public.market_interests;
create policy "market_interests own read" on public.market_interests
  for select to authenticated using (from_id = auth.uid());

drop policy if exists "market_interests partner read" on public.market_interests;
create policy "market_interests partner read" on public.market_interests
  for select to authenticated using (public.customer_may(from_id));

-- ---------------------------------------------------------------
-- ④ 確かめ
-- ---------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='buy_criteria')          as "買いたい条件の表",
  (select count(*) from pg_policies
    where schemaname='public' and tablename='buy_criteria'
      and policyname='buy_criteria may')                                 as "買いたい条件の見張り",
  (select count(*) from pg_policies
    where schemaname='public' and tablename='market_interests'
      and policyname='market_interests own insert')                      as "関心の書き込み",
  (select count(*) from pg_policies
    where schemaname='public' and tablename='market_interests'
      and policyname='market_interests partner read')                    as "関心の担当読み",
  (select count(*) from pg_indexes
    where schemaname='public' and tablename='market_interests'
      and indexname='market_interests_once')                             as "関心の一意";
--  期待値：1、1、1、1、1
-- =============================================================
