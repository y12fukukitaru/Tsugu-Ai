-- =============================================================
-- AI中継（ai-proxy）の利用記録：1人あたり1日の回数を数えるための表
-- ---------------------------------------------------------------
--  登録は誰でもできるため、上限が無いと「試しに100回」で費用が出る。
--  ai-proxy は呼ばれるたびにここへ1行入れ、日本時間の今日ぶんを数えて
--  既定60回で止める（Secret の AI_DAILY_LIMIT で変えられる）。
--
--  画面からは見えない表。書くのも読むのも Edge Function（サービスロール）だけ。
--  ポリシーを一つも作らないことで、それを実現している。
--  運営が集計したいときは、SQL Editor から直接読む（下に例）。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           一度だけ。二度流しても壊れない（if not exists）。
-- =============================================================

create table if not exists public.ai_calls (
  id       bigserial primary key,
  user_id  uuid        not null,
  model    text,
  at       timestamptz not null default now()
);

--  「この人の今日ぶん」を引く索引。ai-proxy が毎回この形で数える
create index if not exists ai_calls_user_at
  on public.ai_calls (user_id, at desc);

--  RLS は有効にし、ポリシーは作らない。
--  → anon / authenticated からは読めず書けず。service_role は RLS を素通りする。
alter table public.ai_calls enable row level security;

-- ---------------------------------------------------------------
-- 確認（Run のあとに、この2つだけ見れば十分）
-- ---------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='ai_calls')            as 表,
  (select count(*) from pg_policies
    where schemaname='public' and tablename='ai_calls')               as 権限の本数;
--  期待値：表=1、権限の本数=0（0 が正しい。画面からは触れない表）

-- ---------------------------------------------------------------
-- 運営向け：使われかたを見る（任意）
-- ---------------------------------------------------------------
-- 今日、誰が何回使ったか（日本時間）
-- select p.company_name, p.contact_name, count(*) as 回数
--   from public.ai_calls a join public.profiles p on p.id = a.user_id
--  where a.at >= (date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo')
--  group by 1,2 order by 3 desc;
--
-- 月ごとの総回数（AI利用料の根拠）
-- select to_char(a.at at time zone 'Asia/Tokyo', 'YYYY-MM') as 月, count(*) as 回数
--   from public.ai_calls a group by 1 order by 1 desc;
