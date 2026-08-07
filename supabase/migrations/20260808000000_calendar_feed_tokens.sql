-- =============================================================
-- Googleカレンダー連携 第1弾: ICS購読フィードのトークン
-- パートナーごとに秘密のフィードURLを発行し、Google/Apple/Outlookの
-- カレンダーに「URLで追加」してもらうと、TsuguAiの面談予定が自動表示される。
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて実行
-- =============================================================

create table if not exists public.calendar_feed_tokens (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  token      text not null unique
             default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);

alter table public.calendar_feed_tokens enable row level security;

-- 発行・確認は本人のみ。フィード配信（tokenでの照合）はservice roleが行う。
create policy "own calendar token: select" on public.calendar_feed_tokens
  for select using (auth.uid() = user_id);

create policy "own calendar token: insert" on public.calendar_feed_tokens
  for insert with check (auth.uid() = user_id);

-- 万一URLが漏れた場合は、行を削除して再発行（新しいtokenで再作成）できるようにする
create policy "own calendar token: delete" on public.calendar_feed_tokens
  for delete using (auth.uid() = user_id);
