-- =============================================================
-- 実行済みかどうかの確認
--   これは「調べるだけ」の SQL です。何も変更しません。
--   Supabase Dashboard → SQL Editor に貼り付けて Run すると、
--   これまでにお渡しした SQL がそれぞれ入っているかが一覧で出ます。
--   ❌ が出た行だけ、対応するファイルを実行してください。
-- =============================================================

select * from (
  select 1 as 順, 'チャットの添付：列（chat_messages.attachment_path）' as 項目,
    case when exists (select 1 from information_schema.columns
      where table_schema='public' and table_name='chat_messages' and column_name='attachment_path')
      then '✅ 実行済み' else '❌ 未実行' end as 状態,
    '20260808120000_chat_attachments.sql' as ファイル
  union all
  select 2, 'チャットの添付：保管場所（storage bucket: chat-attach）',
    case when exists (select 1 from storage.buckets where id='chat-attach')
      then '✅ 実行済み' else '❌ 未実行' end,
    '20260808120000_chat_attachments.sql'
  union all
  select 3, 'チャットの添付：保管場所の権限（2本）',
    case when (select count(*) from pg_policies where schemaname='storage' and tablename='objects'
               and policyname in ('chat attach upload','chat attach read')) = 2
      then '✅ 実行済み' else '❌ 未実行' end,
    '20260808120000_chat_attachments.sql'
  union all
  select 4, '支払明細：顧客が自社の入金を見られる',
    case when exists (select 1 from pg_policies where schemaname='public' and tablename='revenue_entries'
      and policyname='customer reads own revenue entries')
      then '✅ 実行済み' else '❌ 未実行' end,
    '20260811150000_payment_statements.sql'
  union all
  select 5, '支払明細：パートナーが担当顧客の入金を見られる',
    case when exists (select 1 from pg_policies where schemaname='public' and tablename='revenue_entries'
      and policyname='partner reads own customers revenue entries')
      then '✅ 実行済み' else '❌ 未実行' end,
    '20260811150000_payment_statements.sql'
  union all
  select 6, '割引設定の共有（app_settings テーブル）',
    case when exists (select 1 from information_schema.tables
      where table_schema='public' and table_name='app_settings')
      then '✅ 実行済み' else '❌ 未実行' end,
    '20260811170000_app_settings.sql'
  union all
  select 7, '登録コード：テーブル（signup_codes）',
    case when exists (select 1 from information_schema.tables
      where table_schema='public' and table_name='signup_codes')
      then '✅ 実行済み' else '❌ 未実行' end,
    '20260814150000_signup_codes.sql'
  union all
  select 8, '登録コード：はじめの設定の記録（profiles.onboarded）',
    case when exists (select 1 from information_schema.columns
      where table_schema='public' and table_name='profiles' and column_name='onboarded')
      then '✅ 実行済み' else '❌ 未実行' end,
    '20260814150000_signup_codes.sql'
  union all
  select 9, '登録コード：引き換えの関数（redeem_signup_code）',
    case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='redeem_signup_code')
      then '✅ 実行済み' else '❌ 未実行' end,
    '20260814150000_signup_codes.sql'
  union all
  select 13, '初期診断レポートの公開状態（onboarding_reports.status）',
    case when exists (select 1 from information_schema.columns
      where table_schema='public' and table_name='onboarding_reports' and column_name='status')
      then '✅ 実行済み' else '❌ 未実行' end,
    '20260817000000_onboarding_reports_status.sql'
  union all
  select 15, '初期診断報告書の列がそろっているか（cash など）',
    case when exists (select 1 from information_schema.columns
      where table_schema='public' and table_name='onboarding_reports' and column_name='cash')
      then '✅ 実行済み' else '❌ 未実行' end,
    '20260817020000_onboarding_reports_columns.sql'
  union all
  select 14, '初期診断レポート：下書きを顧客から隠す',
    case when exists (select 1 from pg_policies
      where schemaname='public' and tablename='onboarding_reports'
        and policyname='onbr_customer_read' and qual like '%published%')
      then '✅ 実行済み' else '❌ 未実行' end,
    '20260817010000_onboarding_reports_draft_privacy.sql'
  union all
  select 12, '継ナビくんのカレンダー（agenda_events）',
    case when exists (select 1 from information_schema.tables
      where table_schema='public' and table_name='agenda_events')
      then '✅ 実行済み' else '❌ 未実行' end,
    '20260816090000_agenda_events.sql'
  union all
  select 11, '権限昇格の防止（profiles の特権列トリガー）',
    case when exists (select 1 from pg_trigger
      where tgrelid='public.profiles'::regclass and not tgisinternal
        and tgname='profiles_freeze_privileged')
      then '✅ 実行済み' else '❌ 未実行（重大）' end,
    '20260816070000_profiles_freeze_privileged.sql'
  union all
  select 16, '会話の一区切り（chat_threads）',
    case when exists (select 1 from information_schema.tables
      where table_schema='public' and table_name='chat_threads')
      then '✅ 実行済み' else '❌ 未実行' end,
    '20260818120000_chat_threads.sql'
  union all
  select 17, '「今日の一手」の保持期間を14日に短縮',
    case when exists (select 1 from cron.job
      where jobname='agent-insights-cleanup' and schedule='30 18 * * *')
      then '✅ 実行済み' else '❌ 未実行' end,
    '20260825000000_agent_insights_retention.sql'
  union all
  select 18, '顧客のやることメモ（customer_todos）',
    case when exists (select 1 from information_schema.tables
      where table_schema='public' and table_name='customer_todos')
      then '✅ 実行済み' else '❌ 未実行' end,
    '20260826000000_customer_todos.sql'
  union all
  select 19, '法人エンタープライズ・パートナー（ep_orgs ほか5表）',
    case when (select count(*) from information_schema.tables
      where table_schema='public'
        and table_name in ('ep_orgs','ep_members','ep_clients','ep_grants','ep_audit'))=5
      then '✅ 実行済み' else '❌ 未実行' end,
    '20260826010000_enterprise_partners.sql'
  union all
  select 20, '個人・法人の区別（源泉徴収の要否）',
    case when (select count(*) from information_schema.columns
      where table_schema='public'
        and (table_name,column_name) in (('profiles','entity_type'),('ep_orgs','entity_type')))=2
      then '✅ 実行済み' else '❌ 未実行' end,
    '20260826020000_entity_type.sql'
  union all
  select 21, '法人パートナーの区分を EP-I / EP-II に整理',
    case when exists (select 1 from pg_constraint
      where conrelid='public.ep_orgs'::regclass and conname='ep_orgs_kind_check')
      and not exists (select 1 from public.ep_orgs where kind not in ('EP1','EP2'))
      then '✅ 実行済み' else '❌ 未実行' end,
    '20260826030000_ep_kind_rename.sql'
  union all
  select 10, 'プロフィール画像（profiles.avatar）',
    case when exists (select 1 from information_schema.columns
      where table_schema='public' and table_name='profiles' and column_name='avatar')
      then '✅ 実行済み' else '❌ 未実行' end,
    '20260815090000_profile_avatar.sql'
) t order by 順;
