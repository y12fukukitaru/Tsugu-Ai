-- =============================================================
-- 契約の締結を、メールと LINE でも知らせるための印
-- ---------------------------------------------------------------
--  相手が契約書に同意した瞬間、送った人・担当・運営に届くお知らせは、
--  これまでアプリの中（継ナビくん）だけだった。Edge Function（contract-send）
--  が同じ文面をメールと LINE で外へ運ぶようにする。
--  二重に送らないための印が、この notified_at。同意した本人の画面から
--  一度だけ呼ばれ、印の付いていない契約にだけ送る。
--
--  確かめかた：知らせの列=1
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--           何度流しても同じ結果になります。
--   このあと Edge Function を配り直す：
--   supabase functions deploy contract-send --no-verify-jwt
-- =============================================================
alter table public.contract_offers add column if not exists notified_at timestamptz;
comment on column public.contract_offers.notified_at is
  '締結の知らせ（メール・LINE）を送った日時。null なら未送信。contract-send が一度だけ付ける';

select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='contract_offers' and column_name='notified_at') as "知らせの列";
--  期待値：1
-- =============================================================
