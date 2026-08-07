-- =============================================================
-- 継ナビくん Phase 2: プッシュ通知の購読先を貯めるテーブル
-- 「ホーム画面に追加」したアプリ（PWA）への通知配信に使う。
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて実行
-- =============================================================

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  subscription jsonb not null,   -- PushSubscription.toJSON()（endpoint / keys）
  created_at   timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- 登録・確認・削除は本人のみ。配信（読み取り）はservice roleが行う。
create policy "own push subs: select" on public.push_subscriptions
  for select using (auth.uid() = user_id);

create policy "own push subs: insert" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);

create policy "own push subs: delete" on public.push_subscriptions
  for delete using (auth.uid() = user_id);
