-- =============================================================
-- LINE連携: 継ナビくんのブリーフをLINE公式アカウントから届ける
-- 紐付けの流れ:
--   ①アプリで6桁コードを発行（line_link_codes・10分有効）
--   ②TsuguAi公式LINEを友だち追加し、トークにコードを送信
--   ③line-webhook がコードを照合し line_links に保存 → 配信開始
-- 実行方法: Supabase Dashboard → SQL Editor に貼り付けて実行
-- =============================================================

create table if not exists public.line_links (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  line_user_id text not null unique,
  created_at   timestamptz not null default now()
);

alter table public.line_links enable row level security;

-- 確認・解除は本人のみ。作成（コード照合後のinsert）はservice role（webhook）が行う。
create policy "own line link: select" on public.line_links
  for select using (auth.uid() = user_id);

create policy "own line link: delete" on public.line_links
  for delete using (auth.uid() = user_id);

create table if not exists public.line_link_codes (
  code       text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.line_link_codes enable row level security;

-- コードの発行は本人のみ。照合・削除はservice role（webhook）が行う。
create policy "own line code: insert" on public.line_link_codes
  for insert with check (auth.uid() = user_id);

create policy "own line code: select" on public.line_link_codes
  for select using (auth.uid() = user_id);
