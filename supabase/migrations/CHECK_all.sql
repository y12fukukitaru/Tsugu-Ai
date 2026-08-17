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
  select 10, 'プロフィール画像（profiles.avatar）',
    case when exists (select 1 from information_schema.columns
      where table_schema='public' and table_name='profiles' and column_name='avatar')
      then '✅ 実行済み' else '❌ 未実行' end,
    '20260815090000_profile_avatar.sql'
) t order by 順;
