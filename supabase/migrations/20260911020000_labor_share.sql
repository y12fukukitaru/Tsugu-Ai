-- =============================================================
-- 月次財務データに「人件費」を足す（労働分配率のため）
-- ---------------------------------------------------------------
--  労働分配率 ＝ 人件費 ÷ 付加価値（粗利で近似）。賃金が上がり続ける中で
--  利益を出し続けるには、この率を業種の目安の中に保つ打ち手（労働時間の
--  短縮・配置転換・値上げ）を数字で選べなければならない。
--  試算表の取り込みと手入力の両方で「人件費」を月次に持てるようにする。
--  人件費 ＝ 役員報酬＋給料手当＋賞与＋法定福利費＋福利厚生費（万円）。
--
--  確かめかた：人件費の列=1
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度流しても同じ結果になります。
-- =============================================================
alter table public.financial_entries add column if not exists labor_cost numeric;
comment on column public.financial_entries.labor_cost is
  '人件費（万円/月）。役員報酬＋給料手当＋賞与＋法定福利費＋福利厚生費。労働分配率＝人件費÷粗利';

select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='financial_entries' and column_name='labor_cost') as "人件費の列";
--  期待値：1
-- =============================================================
