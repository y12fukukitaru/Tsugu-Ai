-- =============================================================
-- 初期診断レポートの公開状態（status）
--
--  画面には「下書き（顧客に非表示）／公開（顧客に表示）」の切り替えが
--  あり、保存時に status を書き、顧客側は status='published' だけを
--  読むようになっている。ところが列そのものが無かったため、
--    ・パートナーの「保存する」が必ず失敗（＝機能が丸ごと使えない）
--    ・顧客側も読み取りで失敗
--  という状態だった。列を足す。
--
--  既存の行は draft（顧客に非表示）から始める。これまで顧客に見えて
--  いなかったものを、この移行で勝手に公開してしまわないため。
--  公開したいものは、パートナーが画面から「公開」にして保存する。
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
-- =============================================================

alter table public.onboarding_reports
  add column if not exists status text not null default 'draft';

alter table public.onboarding_reports
  drop constraint if exists onboarding_reports_status_chk;
alter table public.onboarding_reports
  add constraint onboarding_reports_status_chk
  check (status in ('draft', 'published'));


-- =============================================================
-- 確認（Run したあとに、この select だけを実行してください）
--
--  ① 列が入ったか、いまの中身はどうか
-- =============================================================
-- select status as 公開状態, count(*) as 件数
--   from public.onboarding_reports group by status;

-- =============================================================
--  ② 顧客が「下書き」を読めてしまわないか（権限の確認）
--
--   下の一覧に、顧客向けの select ポリシーが出ます。
--   「読める条件」に status の指定が無い場合、画面では絞っていても
--   本気で取りに行けば下書きも読めてしまいます。
--   結果を報告いただければ、絞り込みのポリシーをお渡しします。
-- =============================================================
-- select policyname as 名前, cmd as 操作,
--        array_to_string(roles,',') as 対象,
--        qual as 読める条件, with_check as 書ける条件
--   from pg_policies
--  where schemaname='public' and tablename='onboarding_reports'
--  order by cmd, policyname;
