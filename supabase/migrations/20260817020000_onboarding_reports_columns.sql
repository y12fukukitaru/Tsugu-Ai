-- =============================================================
-- 初期診断報告書：足りない列をまとめて足す
--
--  status を足したあと、次は cash が無いと出た。表そのものが、画面が
--  書き込む形と食い違っている。1つずつ潰すと保存のたびに次のエラーが
--  出るので、画面が書く列を全部そろえる。
--
--  add column if not exists なので、すでにある列はそのまま。何度実行
--  しても同じ結果になる。
--
--  列の意味（すべて画面の入力欄に対応）
--    ① 企業価値診断   op_profit 営業利益／dep 減価償却費／multiple 評価倍率
--                     cash 現預金／debt 有利子負債／value_note 所見
--    ② 資金繰りの現状 cash_now 現預金／month_out 月次支出／month_sales 月商
--                     loan_balance 借入残高／repay_year 年間返済額／cash_note 所見
--    ③ 保険の棚卸し   insurances（配列）
--    ④ ロードマップ   roadmap（配列）
--    共通             report_date 報告日／summary 総括／created_by 作成者
--
--  金額はすべて万円。小数が入りうるので numeric にする。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
-- =============================================================

alter table public.onboarding_reports add column if not exists report_date  date;
alter table public.onboarding_reports add column if not exists created_by   uuid;
alter table public.onboarding_reports add column if not exists updated_at   timestamptz not null default now();

-- ① 企業価値診断
alter table public.onboarding_reports add column if not exists op_profit    numeric;
alter table public.onboarding_reports add column if not exists dep          numeric;
alter table public.onboarding_reports add column if not exists multiple     numeric;
alter table public.onboarding_reports add column if not exists cash         numeric;
alter table public.onboarding_reports add column if not exists debt         numeric;
alter table public.onboarding_reports add column if not exists value_note   text;

-- ② 資金繰りの現状
alter table public.onboarding_reports add column if not exists cash_now     numeric;
alter table public.onboarding_reports add column if not exists month_out    numeric;
alter table public.onboarding_reports add column if not exists month_sales  numeric;
alter table public.onboarding_reports add column if not exists loan_balance numeric;
alter table public.onboarding_reports add column if not exists repay_year   numeric;
alter table public.onboarding_reports add column if not exists cash_note    text;

-- ③④ 保険の棚卸し・12ヶ月ロードマップ（配列）
alter table public.onboarding_reports add column if not exists insurances   jsonb not null default '[]'::jsonb;
alter table public.onboarding_reports add column if not exists roadmap      jsonb not null default '[]'::jsonb;

-- 総括
alter table public.onboarding_reports add column if not exists summary      text;

-- upsert(onConflict:'customer_id') が効くように、顧客ごとに1行であることを保証する
create unique index if not exists onboarding_reports_customer_uniq
  on public.onboarding_reports (customer_id);


-- =============================================================
-- 確認（Run したあとに、この select だけを実行してください）
--   画面が書き込む列が、すべて揃っているかを見ます。
--   「❌ 足りません」が出なければ完了です。
-- =============================================================
-- with need(col) as (values
--   ('customer_id'),('report_date'),('status'),('created_by'),('updated_at'),
--   ('op_profit'),('dep'),('multiple'),('cash'),('debt'),('value_note'),
--   ('cash_now'),('month_out'),('month_sales'),('loan_balance'),('repay_year'),('cash_note'),
--   ('insurances'),('roadmap'),('summary')
-- )
-- select n.col as 列,
--        case when c.column_name is null then '❌ 足りません' else '✅' end as 状態,
--        c.data_type as 型
--   from need n
--   left join information_schema.columns c
--     on c.table_schema='public' and c.table_name='onboarding_reports' and c.column_name=n.col
--  order by 状態, n.col;
