-- =============================================================
-- メッセージのファイル添付
--  1) chat_messages に添付ファイルの列を追加
--  2) 添付ファイル用の非公開ストレージバケット chat-attach を作成
--  3) ログイン済みユーザーのアップロード・閲覧を許可するポリシー
--     （閲覧は署名付きURL経由。パスは「顧客ID/タイムスタンプ_乱数.拡張子」で
--       推測不能なため、v1はログイン済み全体に read を許可するシンプルな設計）
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて Run
-- =============================================================

alter table public.chat_messages add column if not exists attachment_path text;
alter table public.chat_messages add column if not exists attachment_name text;

insert into storage.buckets (id, name, public)
values ('chat-attach', 'chat-attach', false)
on conflict (id) do nothing;

drop policy if exists "chat attach upload" on storage.objects;
create policy "chat attach upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-attach');

drop policy if exists "chat attach read" on storage.objects;
create policy "chat attach read" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-attach');
