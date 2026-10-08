-- =============================================================
-- メッセージと「対応が必要なこと」も、スマホ（アプリ）に通知する
-- ---------------------------------------------------------------
--  20261008010000_push_reminders.sql の続きです（先にそちらを流してください）。
--
--  ■ 増える通知（Edge Function push-reminders が送る）
--    メッセージ
--      ・担当とのメッセージ（経営者 ⇄ 担当パートナー）
--      ・運営からの回答（問い合わせたパートナーへ）
--      ・運営からのお知らせ（宛先の方へ）
--    対応が必要なこと
--      ・対応事項（担当パートナーが登録したら、経営者へ。期日の日は朝8時のまとめにも）
--      ・継ナビくんの相談の共有（経営者が「伝える」を押したら、担当パートナーへ）
--      ・月次レポートの公開（経営者へ）
--      ・問い合わせ・解約のご依頼・契約の終了のお申し出・プラン切替の依頼（運営へ）
--
--  ■ この SQL がすること
--    ① notify_prefs に「メッセージ」「対応が必要なこと」を知らせるかの列を足す（既定は知らせる）
--    ② 呼び出しを5分ごと → 1分ごとに（メッセージは届いてすぐ知らせたいので）
--
--  確かめかた（いちばん下）：列=2、毎分=1 が出れば完了
--
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
--   先に Edge Function「push-reminders」を新しい中身で再デプロイしておくこと
-- =============================================================

-- ① 設定の列 --------------------------------------------------
alter table public.notify_prefs add column if not exists msg_on boolean not null default true;
alter table public.notify_prefs add column if not exists act_on boolean not null default true;

comment on column public.notify_prefs.msg_on is 'メッセージ（担当とのやり取り・運営からの回答・お知らせ）を知らせるか';
comment on column public.notify_prefs.act_on is '対応が必要なこと（対応事項・相談の共有・月次レポート・運営あての依頼）を知らせるか';

-- ② 1分ごとに --------------------------------------------------
do $do$
declare
  j bigint;
begin
  select jobid into j from cron.job where jobname = 'push-reminders';
  if j is null then
    raise exception '呼び出し（push-reminders）が見つかりません。先に 20261008010000_push_reminders.sql を流してください';
  end if;
  perform cron.alter_job(job_id := j, schedule := '* * * * *');
end
$do$;

-- 確かめる -----------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'notify_prefs' and column_name in ('msg_on', 'act_on')) as "列",
  (select count(*) from cron.job where jobname = 'push-reminders' and schedule = '* * * * *')          as "毎分";
